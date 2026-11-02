import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  branchTarget,
  deletePreview,
  previewProject,
  runAction,
} from "./index.mjs";

/** @type {import("./index.mjs").Repository} */
const repository = { full_name: "ubiquity/pay.ubq.fi", default_branch: "main" };
/** @param {string} branch @param {Partial<import("./index.mjs").GitHubEvent>} [extra] */
const push = (branch, extra = {}) => ({
  repository,
  ref: `refs/heads/${branch}`,
  ...extra,
});
/** @param {string} branch @param {string} [ref_type] */
const deletion = (branch, ref_type = "branch") => ({
  repository,
  ref: branch,
  ref_type,
});

/** @param {string} eventName @param {import("./index.mjs").GitHubEvent} event */
function fixture(eventName, event) {
  const dir = mkdtempSync(fileURLToPath(new URL(".test-", import.meta.url)));
  const eventPath = join(dir, "event.json");
  writeFileSync(eventPath, JSON.stringify(event));
  return {
    dir,
    env: {
      INPUT_PROJECT: "pay-ubq-fi",
      GITHUB_EVENT_NAME: eventName,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REF: "refs/heads/main",
      GITHUB_OUTPUT: join(dir, "output"),
    },
  };
}

test("branch projects are deterministic, DNS-safe, bounded, and preserve the router suffix", () => {
  for (
    const project of ["ubq-fi", "pay-ubq-fi", "abcdefghijklmnopqrs-ubq-fi"]
  ) {
    for (
      const branch of [
        "feat/widget",
        "staging",
        "A/Very-Long-Feature-Name".repeat(8),
        "☃",
      ]
    ) {
      const name = previewProject(project, branch);
      assert.equal(name, previewProject(project, branch));
      assert.match(name, /^[a-z0-9][a-z0-9-]*-ubq-fi$/);
      assert.ok(name.length <= 26, name);
      assert.notEqual(name, project);
    }
  }
  assert.match(
    previewProject("pay-ubq-fi", "feat/widget"),
    /^feat-w-[a-f0-9]{8}-pay-ubq-fi$/,
  );
});

test("normalization and truncation do not merge distinct branch or project identities", () => {
  const branches = [
    "feat/widget",
    "feat-widget",
    "Feat/Widget",
    "feat_widget",
    "feat/widget-one".repeat(5),
    "feat/widget-two".repeat(5),
  ];
  assert.equal(
    new Set(branches.map((branch) => previewProject("pay-ubq-fi", branch)))
      .size,
    branches.length,
  );
  assert.notEqual(
    previewProject("abcdefgh-one-ubq-fi", "feature"),
    previewProject("abcdefgh-two-ubq-fi", "feature"),
  );
});

test("invalid projects and unsafe output values fail before deployment or deletion", () => {
  for (
    const project of [
      "",
      "pay",
      "Pay-ubq-fi",
      "-pay-ubq-fi",
      "a".repeat(20) + "-ubq-fi",
    ]
  ) {
    assert.throws(() => previewProject(project, "feat/widget"), /project must/);
  }
  for (const branch of ["", "feat\nwidget", "feat\rwidget", "feat widget"]) {
    assert.throws(() => previewProject("pay-ubq-fi", branch), /source branch/);
  }
});

test("default branch remains production and other pushes use their own previews", () => {
  assert.equal(
    branchTarget("pay-ubq-fi", "push", push("main")).preview_project,
    "",
  );
  const target = branchTarget("pay-ubq-fi", "push", push("feat/widget"));
  assert.equal(target.deploy, true);
  assert.equal(target.cleanup, false);
  assert.equal(
    target.preview_project,
    previewProject("pay-ubq-fi", "feat/widget"),
  );
});

test("PRs use the head branch, never the merge ref or production project", () => {
  const event = {
    repository,
    pull_request: { head: { ref: "main", repo: repository } },
  };
  const target = branchTarget(
    "pay-ubq-fi",
    "pull_request",
    event,
    "refs/pull/42/merge",
  );
  assert.equal(target.branch, "main");
  assert.equal(target.preview_project, previewProject("pay-ubq-fi", "main"));
  event.pull_request.head.repo = { full_name: "fork/pay.ubq.fi" };
  assert.equal(branchTarget("pay-ubq-fi", "pull_request", event).deploy, false);
});

test("workflow_run resolves the source head and forks cannot address internal previews", () => {
  const event = {
    repository,
    workflow_run: {
      head_repository: repository,
      head_branch: "feat/widget",
      event: "pull_request",
    },
  };
  assert.equal(
    branchTarget("pay-ubq-fi", "workflow_run", event).branch,
    "feat/widget",
  );
  event.workflow_run.head_branch = "main";
  assert.notEqual(
    branchTarget("pay-ubq-fi", "workflow_run", event).preview_project,
    "",
  );
  event.workflow_run.head_repository = { full_name: "fork/pay.ubq.fi" };
  assert.equal(branchTarget("pay-ubq-fi", "workflow_run", event).deploy, false);
});

test("delete and deleted pushes target the same project as the original branch push", () => {
  const project =
    branchTarget("pay-ubq-fi", "push", push("feat/widget")).preview_project;
  /** @type {Array<[string, import("./index.mjs").GitHubEvent]>} */
  const events = [["delete", deletion("feat/widget")], [
    "push",
    push("feat/widget", { deleted: true }),
  ]];
  for (const [name, event] of events) {
    const target = branchTarget("pay-ubq-fi", name, event, "refs/heads/main");
    assert.equal(target.preview_project, project);
    assert.equal(target.deploy, false);
    assert.equal(target.cleanup, true);
  }
});

test("tag events, default branch deletion, and configured production deletion never clean up", () => {
  /** @type {Array<[string, import("./index.mjs").GitHubEvent]>} */
  const events = [
    ["delete", deletion("main")],
    ["delete", deletion("development")],
    ["delete", deletion("v1", "tag")],
    ["push", { repository, ref: "refs/tags/v1", deleted: true }],
    ["push", push("development", { deleted: true })],
  ];
  for (const [name, event] of events) {
    const target = branchTarget(
      "pay-ubq-fi",
      name,
      event,
      "refs/heads/main",
      "development",
    );
    assert.equal(target.deploy, false);
    assert.equal(target.cleanup, false);
  }
});

test("manual dispatch respects the selected ref and production override", () => {
  assert.equal(
    branchTarget(
      "pay-ubq-fi",
      "workflow_dispatch",
      { repository },
      "refs/heads/development",
      "development",
    ).preview_project,
    "",
  );
  assert.equal(
    branchTarget(
      "pay-ubq-fi",
      "workflow_dispatch",
      { repository },
      "refs/heads/feat/widget",
    ).branch,
    "feat/widget",
  );
  assert.equal(
    branchTarget(
      "pay-ubq-fi",
      "workflow_dispatch",
      { repository },
      "refs/tags/v1",
    ).deploy,
    false,
  );
});

test("Classic cleanup uses authenticated DELETE and treats missing projects as success", async () => {
  for (const status of [204, 404]) {
    await deletePreview("feat-w-12345678-pay-ubq-fi", {
      token: "test-token",
      fetchImpl: (url, options) => {
        assert.equal(
          url,
          "https://dash.deno.com/api/projects/feat-w-12345678-pay-ubq-fi",
        );
        assert.equal(options.method, "DELETE");
        assert.equal(
          new Headers(options.headers).get("Authorization"),
          "Bearer test-token",
        );
        return new Response(null, { status });
      },
    });
  }
});

test("cleanup failures are actionable and do not expose credentials", async () => {
  await assert.rejects(
    deletePreview("preview", { token: "" }),
    /deno_token is required/,
  );
  await assert.rejects(
    deletePreview("preview", { token: "test-token", platform: "other" }),
    /deploy_platform/,
  );
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(
      deletePreview("preview", {
        token: "test-token",
        fetchImpl: () => new Response("test-token", { status }),
      }),
      { message: `Preview deletion failed (HTTP ${status})` },
    );
  }
});

test("Deno 2 cleanup scopes the SDK to the organization and passes credentials only via env", async () => {
  await deletePreview("feat-w-12345678-pay-ubq-fi", {
    platform: "deno2",
    org: "test-org",
    token: "test-token",
    run: (command, args, options) => {
      assert.equal(command, "deno");
      assert.equal(args[0], "eval");
      assert.match(args[1], /client\.apps\.delete\(app.slug\)/);
      assert.match(args[1], /app.slug === project/);
      assert.ok(!args.join(" ").includes("test-token"));
      assert.ok(options.env);
      assert.equal(options.env.PREVIEW_PROJECT, "feat-w-12345678-pay-ubq-fi");
      assert.equal(options.env.DENO_DEPLOY_ORG, "test-org");
      assert.equal(options.env.DENO_DEPLOY_TOKEN, "test-token");
      return { status: 0 };
    },
  });
  await assert.rejects(
    deletePreview("preview", {
      platform: "deno2",
      token: "test-token",
      run: () => ({ status: 1 }),
    }),
    /Deno 2 preview deletion failed/,
  );
});

test("action entrypoint emits usable outputs without credentials on normal pushes", () => {
  const { dir, env } = fixture("push", push("feat/widget"));
  try {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("index.mjs", import.meta.url)),
    ], {
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(env.GITHUB_OUTPUT, "utf8"),
      `branch=feat/widget\npreview_project=${
        previewProject("pay-ubq-fi", "feat/widget")
      }\ndeploy=true\n`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("branch deletion completes before emitting deploy=false", async () => {
  const { dir, env } = fixture("delete", deletion("feat/widget"));
  try {
    let deleted = false;
    await runAction({ ...env, INPUT_DENO_TOKEN: "test-token" }, {
      fetchImpl: () => {
        deleted = true;
        return new Response(null, { status: 204 });
      },
    });
    assert.ok(deleted);
    assert.match(readFileSync(env.GITHUB_OUTPUT, "utf8"), /deploy=false\n$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reserved router prefixes cannot redirect a branch into legacy preview or plugin apps", () => {
  for (const project of ["ubq-fi", "a-ubq-fi", "pay-ubq-fi"]) {
    for (const branch of ["preview", "preview/widget", "os", "os/feature"]) {
      assert.doesNotMatch(previewProject(project, branch), /^(preview|os)-/);
    }
  }
});

test("production and tag deletion need no token and never call the deployment APIs", async () => {
  for (const event of [deletion("main"), deletion("v1", "tag")]) {
    const { dir, env } = fixture("delete", event);
    try {
      const target = await runAction(env, {
        fetchImpl: () => {
          throw new Error("Unexpected cleanup request");
        },
        run: () => {
          throw new Error("Unexpected cleanup command");
        },
      });
      assert.equal(target.cleanup, false);
      assert.match(readFileSync(env.GITHUB_OUTPUT, "utf8"), /deploy=false\n$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
