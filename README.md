# Reusable Deno Deploy workflow

This repository provides a standardized, reusable Deno Deploy workflow at `.github/workflows/deno-deploy-reusable.yml` for all ubiquity ubq.fi subdomains. It consolidates deployment patterns across the organization, ensuring consistent CI/CD with shared Supabase secrets and flexible build configurations.

## What it does

- Supports Deno 2.x (default) with configurable versions.
- Supports new Deno Deploy (`deno deploy`, `.deno.net`) via `deploy_platform: deno2`; Deploy Classic (`deployctl`, `.deno.dev`) remains the default during migration.
- Optional Node.js and Bun setup for builds (uses official install scripts).
- Configurable install/build commands (multi-line supported).
- Branch-aware deployments: production on the repository default branch, with isolated branch previews and deletion cleanup using the helper action in the template below.
- Automatic preview project creation if missing.
- Optional project existence check. `project_secrets` are forwarded as runtime env for the deploy (Deno Deploy secrets API is no longer supported).
- Gitignore-based excludes with custom includes for build outputs.
- Runtime env var forwarding (preferred over env_var_keys for simplicity).
- Post-deploy URL verification and HTTP probing, auto-extracting asset paths from your built `index.html` so hashed bundles are probed without manual lists (index file is auto-discovered; override with `index_html_path` only if needed).
- Preflight checks for required secrets (skips deploy if missing).
- On `push`/`pull_request` runs, posts/updates a PR comment with preview deployment URLs when the commit is associated with an open PR (disable with `comment_pr: false`; requires `issues: write`, and for `push` runs also `pull-requests: read`).

## How to use (standardized template)

Each ubq.fi subdomain repo now uses this standardized workflow. Add or update `.github/workflows/deno-deploy.yml`:

```yaml
name: Deno Deploy

on:
  push:
  pull_request:
  workflow_dispatch:
  delete:

# Serialize pushes and deletions of the same branch, including PR head branches.
concurrency:
  group: deno-${{ github.workflow }}-${{ github.event_name == 'delete' && github.event.ref || github.head_ref || github.ref_name }}
  cancel-in-progress: true

jobs:
  preview:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      deploy: ${{ steps.target.outputs.deploy }}
      project: ${{ steps.target.outputs.preview_project }}
    steps:
      # No checkout: deleted branches no longer exist and fork code must not run with secrets.
      - uses: ubiquity/deno-deploy-workflow/actions/branch-preview@main
        id: target
        with:
          project: <subdomain>-ubq-fi
          deno_token: ${{ secrets.DENO_DEPLOY_TOKEN }}

  deploy:
    needs: preview
    if: needs.preview.outputs.deploy == 'true'
    permissions:
      contents: read
      issues: write
      pull-requests: write
    uses: ubiquity/deno-deploy-workflow/.github/workflows/deno-deploy-reusable.yml@main
    with:
      project: <subdomain>-ubq-fi
      entrypoint: serve.ts
      preview_project: ${{ needs.preview.outputs.project }}
      # Add build-specific inputs as needed (bun_version, node_version, install_command, build_command, include, runtime_env, build_env)
      project_secrets: |
        SUPABASE_URL=SUPABASE_URL
        SUPABASE_ANON_KEY=SUPABASE_ANON_KEY
    secrets: inherit
```

Notes:
- For Deno 2 / new Deno Deploy, set `deploy_platform: deno2` and prefer Deno-native commands:
  ```yaml
  with:
    project: <subdomain>-ubq-fi
    deploy_platform: deno2
    entrypoint: serve.ts
    install_command: deno install
    build_command: deno task build
  ```
  The workflow creates the app with `deno deploy create`, syncs build/runtime env with `deno deploy env load`, deploys with `deno deploy`, and emits `.deno.net` URLs.
- Use `project_secrets` to forward env vars to the deployment (`SECRET_NAME=ENV_VAR` per line). In Deno 2 mode these are synced as app env before deployment; in Deploy Classic they are forwarded for the current deploy only.
- Org-level secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) are shared; no repo-specific copies needed.
- Customize `include` for build output dirs (e.g., `static/dist/**`).
- Set `bun_version`/`node_version` and commands for repos with builds. If you use Bun, prefer `bun_version: 1.3.x` (latest as of Dec 2025) instead of older 1.2.x pins.
- To opt out of PR comments, set `comment_pr: false` in `with:`.
- `forward_all_secrets: true` (opt-in) forwards all available GitHub secrets as runtime env vars; defaults exclude `DENO_DEPLOY_TOKEN` and `GITHUB_TOKEN`.
- In Deno 2 mode, quota GC is enabled by default only after app creation fails with an app quota/limit error. It deletes one generated preview/branch app, then retries creation once. Production apps, the current target app, and explicitly protected apps are never deleted.
- Secrets managed in GitHub UI—update secret, next deploy forwards it.

### Isolated branch previews and cleanup

The `actions/branch-preview` helper above supplies `preview_project` to the existing reusable workflow, which creates the project/app as usual. Production keeps its existing project and hostname. Direct workflow calls that do not use the helper retain the legacy shared preview behavior.

Each branch gets a DNS-safe prefix, an eight-character hash of the original branch and production project, and the `-ubq-fi` suffix required by the router. Names are clamped to 26 characters, preserving a shortened app name where possible. For example, `feat/widget` for `pay-ubq-fi` produces `feat-w-<hash>-pay-ubq-fi`, served at `feat-w-<hash>-pay.ubq.fi` by the standard subdomain router. The hash is always present so slash/dash aliases, case differences, and truncated names do not share previews. Reserved router prefixes (`preview-` and `os-`) are escaped with `b-`.

Keep `delete` in the **calling repository's default-branch workflow**: reusable workflows cannot subscribe to the caller's events themselves. The helper uses the deletion payload's `ref`, not `github.ref_name`, and deletes only that branch's generated project. It also handles deleted-branch push events. Tag events and default/production branch deletion never deploy or delete projects; missing previews are already clean. Cleanup failures fail the job instead of silently leaking projects. Production is gated on the repository default branch unless `prod_branch` is set to the same value on **both** the helper and reusable workflow.

For Deno 2, pass `deploy_platform: deno2` and the same `deno_org` to **both** the helper and reusable workflow. Add this step **before** the helper so cleanup can use the same Deno SDK as the reusable workflow:

```yaml
- uses: denoland/setup-deno@v2
  if: github.event_name == 'delete' || github.event.deleted == true
  with:
    deno-version: v2.x
```

The helper resolves same-repository PRs from their head branch (and artifact `workflow_run` events from `head_branch`), never from a PR merge ref. Direct fork PRs and fork artifact runs are skipped by this helper to prevent them from targeting another branch's project. Keep the separate fork artifact pipeline below if fork previews are needed; fork branch deletion events are not delivered to the upstream repository.

Local helper checks (no dependencies or network required):

```sh
node --test actions/branch-preview/index.test.mjs
deno fmt --check actions/branch-preview
deno lint actions/branch-preview
```

### Deno 2 Quota GC

Deno Deploy Free plans currently allow a small number of apps, so branch/PR apps can exhaust capacity. The workflow keeps old previews unless a new app cannot be created because of an app quota/limit error.

Defaults:
- `deno2_quota_gc: true`
- Protects the current production app, current preview app, and target app.
- Deletes only generated-looking apps, such as `<base>-ubq-fi-codex-*`, `<base>-ubq-fi-pr-*`, `<base>-ubq-fi-branch-*`, or slugs under configured candidate prefixes.
- Deletes the oldest candidate by `updated_at`, only one app per failed creation attempt.

For custom branch app naming, pass explicit candidate prefixes and any app slugs that must never be deleted:

```yaml
with:
  deno2_quota_gc_candidate_prefixes: |
    ai-ubq-fi-
  deno2_quota_gc_protected_apps: |
    ai-ubq-fi
    p-ai-ubq-fi
```

## Fork PR previews (artifact pipeline)

Forked PRs cannot access secrets or org/repo vars in `pull_request` runs, so deployments must happen in a second workflow. Use the build-only reusable workflow to create an artifact, then a `workflow_run` deploy that downloads the artifact and deploys it. Use `build_env_fork`/`runtime_env_fork` for public values (never service/admin keys).

**PR build (fork-safe)**

```yaml
name: Deno Deploy (PR build)

on:
  pull_request:

jobs:
  build:
    permissions:
      contents: read
      actions: write
    uses: ubiquity/deno-deploy-workflow/.github/workflows/deno-deploy-build.yml@main
    with:
      entrypoint: serve.ts
      root: .
      install_command: |
        bun install --frozen-lockfile
      build_command: bun run build
      include: |
        static/**
      build_env: |
        VITE_SUPABASE_URL=${{ secrets.SUPABASE_URL }}
        VITE_SUPABASE_ANON_KEY=${{ secrets.SUPABASE_ANON_KEY }}
      build_env_fork: |
        VITE_SUPABASE_URL=https://<public-supabase-url>
        VITE_SUPABASE_ANON_KEY=<public-anon-key>
      artifact_name: deno-deploy-artifact
```

**PR deploy (artifact → preview)**

```yaml
name: Deno Deploy (PR preview)

on:
  workflow_run:
    workflows: ["Deno Deploy (PR build)"]
    types: [completed]

jobs:
  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    permissions:
      actions: read
      contents: read
      issues: write
      pull-requests: write
    uses: ubiquity/deno-deploy-workflow/.github/workflows/deno-deploy-reusable.yml@main
    with:
      project: <subdomain>-ubq-fi
      entrypoint: serve.ts
      include: |
        static/**
      artifact_name: deno-deploy-artifact
      artifact_run_id: ${{ github.event.workflow_run.id }}
      artifact_path: .deploy-artifact
      runtime_env_fork: |
        SUPABASE_URL=https://<public-supabase-url>
        SUPABASE_ANON_KEY=<public-anon-key>
    secrets: inherit
```

Notes:
- `runtime_env_fork`/`env_var_keys_fork` apply only to forked PRs; internal branches still use `runtime_env`/`env_var_keys`.
- Set `allow_fork_secrets: true` only if you accept the risk of exposing secrets to untrusted code (not recommended).
- Use the same `include` as your normal deploy so deployctl sees the expected build outputs.
- When using the fork preview pipeline, remove `pull_request` from your normal deploy workflow (or gate it to same-repo branches) to avoid a second deploy attempt that will fail on missing secrets.

### Bun usage (Dec 2025)

- Recommended version: `1.3.x` (latest patch is 1.3.4 as of Dec 2025). The reusable workflow auto-defaults to `1.3.x` when it detects `bun` in install/build commands and no `bun_version` is provided.
- Valid install example (avoids unsupported flags):
  ```yaml
  with:
    bun_version: 1.3.x
    install_command: |
      HUSKY=0 bun install --registry=https://registry.npmjs.org
    build_command: bun run build
  ```
- Avoid `--backend=npm` (not a recognized Bun flag); use `--registry` or env vars for registries instead.

## Migrated Subdomains

All ubq.fi subdomains have been standardized to use this reusable workflow:

- ✅ `audit.ubq.fi` (yarn build, static/out/** + out/**)
- ✅ `card.ubq.fi` (yarn build, multiple static dirs)
- ✅ `demo.ubq.fi` (bun build, static/dist/**)
- ✅ `health.ubq.fi` (Deno-only, src/server/index.ts)
- ✅ `keygen.ubq.fi` (yarn build)
- ✅ `leaderboard.ubq.fi` (yarn build, static/dist/**)
- ✅ `notifications.ubq.fi` (bun build, static/dist/**)
- ✅ `onboard.ubq.fi` (bun build, static/dist/**, extra runtime env)
- ✅ `partner.ubq.fi` (bun build, out/**)
- ✅ `pay.ubq.fi` (bun build frontend subdir, VITE build env)
- ✅ `permit2-allowance.ubq.fi` (bun build, static/dist/**)
- ✅ `safe.ubq.fi` (yarn build, static/dist/**)
- ✅ `stake.ubq.fi` (bun build, dist/**)
- ✅ `uusd.ubq.fi` (bun build, app.js/app.js.map, recursive submodules)
- ✅ `work.ubq.fi` (deno task build, static/dist/**, multiple env vars)
- ✅ `xp.ubq.fi` (bun build, deno/artifact-proxy.ts entrypoint, includes src/dist and fixture zips)

## Troubleshooting

- **Reusable workflow access issues**: If `uses:` fails, inline the workflow temporarily or resolve org permissions.
- **Missing secrets**: Ensure `DENO_DEPLOY_TOKEN` is set; org secrets are inherited.
- **Build failures**: Verify `bun_version`/`node_version` and commands match the repo's setup.
- **Deploy limits**: Deno Deploy has per-hour limits; rerun failed jobs post-cooldown.
- **Verification fails**: Check custom domains or disable `verify_url` if needed.
