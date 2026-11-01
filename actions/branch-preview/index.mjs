import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * @typedef {{full_name?: string, default_branch?: string}} Repository
 * @typedef {{
 *   ref?: string, ref_type?: string, deleted?: boolean, repository?: Repository,
 *   pull_request?: {head?: {ref?: string, repo?: Repository}},
 *   workflow_run?: {head_branch?: string, event?: string, head_repository?: Repository}
 * }} GitHubEvent
 * @typedef {{
 *   token?: string, platform?: string, org?: string,
 *   fetchImpl?: (url: string, options: RequestInit) => Response | Promise<Response>,
 *   run?: (command: string, args: string[], options: import("node:child_process").SpawnSyncOptionsWithStringEncoding) => {status: number | null, error?: Error}
 * }} CleanupOptions
 */

/** @param {string} project @param {string} branch */
export function previewProject(project, branch) {
  if (
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(project) ||
    (project !== "ubq-fi" && !project.endsWith("-ubq-fi")) ||
    project.length > 26
  ) {
    throw new Error(
      "project must be DNS-safe, at most 26 characters, and end in -ubq-fi",
    );
  }
  if (!branch || /[\s\p{Cc}]/u.test(branch)) {
    throw new Error(
      "A source branch without whitespace or control characters is required",
    );
  }

  // Hash the original identity, not the slug: feat/widget and feat-widget differ.
  const hash = createHash("sha256").update(`${project}\0${branch}`).digest(
    "hex",
  ).slice(0, 8);
  let slug =
    branch.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "branch";
  // Do not enter the router's legacy preview or plugin namespaces.
  if (/^(preview|os)(-|$)/.test(slug)) slug = `b-${slug}`;
  const base = project === "ubq-fi"
    ? ""
    : project.slice(0, -7).slice(0, 8).replace(/-+$/, "");
  const suffix = `-${hash}${base ? `-${base}` : ""}-ubq-fi`;
  const prefix = slug.slice(0, 26 - suffix.length).replace(/-+$/, "");
  const preview = `${prefix}${suffix}`;
  if (preview === project) {
    throw new Error("Preview project must differ from production");
  }
  return preview;
}

/**
 * @param {string} project
 * @param {string} eventName
 * @param {GitHubEvent} event
 * @param {string} [ref]
 * @param {string} [prodBranch]
 */
export function branchTarget(
  project,
  eventName,
  event,
  ref = "",
  prodBranch = "",
) {
  const skip = {
    deploy: false,
    cleanup: false,
    preview_project: "",
    branch: "",
  };
  let branch;
  let cleanup = false;
  let pullRequest = false;
  switch (eventName) {
    case "delete":
      if (event.ref_type !== "branch") return skip;
      branch = event.ref;
      cleanup = true;
      break;
    case "push":
      if (!event.ref?.startsWith("refs/heads/")) return skip;
      branch = event.ref.slice("refs/heads/".length);
      cleanup = event.deleted === true;
      break;
    case "pull_request":
      if (
        event.pull_request?.head?.repo?.full_name !==
          event.repository?.full_name
      ) return skip;
      branch = event.pull_request?.head?.ref;
      pullRequest = true;
      break;
    case "workflow_run":
      if (
        event.workflow_run?.head_repository?.full_name !==
          event.repository?.full_name
      ) return skip;
      branch = event.workflow_run?.head_branch;
      pullRequest = event.workflow_run?.event === "pull_request";
      break;
    case "workflow_dispatch":
      if (!ref.startsWith("refs/heads/")) return skip;
      branch = ref.slice("refs/heads/".length);
      break;
    default:
      return skip;
  }

  if (!branch) throw new Error("The event is missing its source branch");
  const preview = previewProject(project, branch);
  const defaultBranch = event.repository?.default_branch;
  const production = prodBranch || defaultBranch;
  if (!production) {
    throw new Error("The repository default branch or prod_branch is required");
  }
  // A delete event's GITHUB_REF usually points at the default branch, not the deleted one.
  if (cleanup && (branch === production || branch === defaultBranch)) {
    return { ...skip, branch };
  }
  return {
    branch,
    cleanup,
    deploy: !cleanup,
    preview_project: !pullRequest && branch === production ? "" : preview,
  };
}

const deleteDeno2 = `
  const { Client } = await import("jsr:@deno/sandbox@0.12.0");
  const client = new Client({ org: Deno.env.get("DENO_DEPLOY_ORG") });
  const project = Deno.env.get("PREVIEW_PROJECT");
  for await (const app of await client.apps.list()) {
    if (app.slug === project) {
      await client.apps.delete(app.slug);
      break;
    }
  }
`;

/** @param {string} project @param {CleanupOptions} options */
export async function deletePreview(project, {
  token,
  platform = "classic",
  org = "ubiquity-dao",
  fetchImpl = fetch,
  run = spawnSync,
}) {
  if (!token) {
    throw new Error("deno_token is required to delete a branch preview");
  }
  if (platform === "deno2") {
    // Match the SDK used by the reusable workflow. Missing apps are already clean.
    const result = run("deno", ["eval", deleteDeno2], {
      env: {
        ...process.env,
        DENO_DEPLOY_TOKEN: token,
        DENO_DEPLOY_ORG: org,
        PREVIEW_PROJECT: project,
      },
      encoding: "utf8",
      timeout: 60_000,
    });
    if (result.error || result.status !== 0) {
      throw new Error(
        "Deno 2 preview deletion failed; verify Deno setup, token, and organization",
      );
    }
    return;
  }
  if (platform !== "classic") {
    throw new Error("deploy_platform must be classic or deno2");
  }
  const response = await fetchImpl(
    `https://dash.deno.com/api/projects/${encodeURIComponent(project)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Preview deletion failed (HTTP ${response.status})`);
  }
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @param {Pick<CleanupOptions, "fetchImpl" | "run">} [dependencies]
 */
export async function runAction(env = process.env, dependencies = {}) {
  const eventPath = env.GITHUB_EVENT_PATH;
  const outputPath = env.GITHUB_OUTPUT;
  const project = env.INPUT_PROJECT;
  const eventName = env.GITHUB_EVENT_NAME;
  if (!eventPath || !outputPath || !project || !eventName) {
    throw new Error(
      "The GitHub action environment and project input are required",
    );
  }
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const target = branchTarget(
    project,
    eventName,
    event,
    env.GITHUB_REF,
    env.INPUT_PROD_BRANCH,
  );
  if (target.cleanup) {
    await deletePreview(target.preview_project, {
      token: env.INPUT_DENO_TOKEN,
      platform: env.INPUT_DEPLOY_PLATFORM || "classic",
      org: env.INPUT_DENO_ORG || "ubiquity-dao",
      ...dependencies,
    });
    console.log(
      `Deleted preview project ${target.preview_project} (or it was already absent).`,
    );
  }
  appendFileSync(
    outputPath,
    [
      `branch=${target.branch}`,
      `preview_project=${target.preview_project}`,
      `deploy=${target.deploy}`,
      "",
    ].join("\n"),
  );
  return target;
}

if (
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runAction();
  } catch (error) {
    console.error(
      `::error::${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
