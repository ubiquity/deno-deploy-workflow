# Reusable Deno Deploy workflow

This repository provides a standardized, reusable Deno Deploy workflow at `.github/workflows/deno-deploy-reusable.yml` for all ubiquity ubq.fi subdomains. It consolidates deployment patterns across the organization, ensuring consistent CI/CD with shared Supabase secrets and flexible build configurations.

## What it does

- Supports Deno 2.x (default) with configurable versions.
- Optional Node.js and Bun setup for builds (uses official install scripts).
- Configurable install/build commands (multi-line supported).
- Branch-aware deployments: production on specified branch (default: `development`), preview on others.
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

jobs:
  deploy:
    permissions:
      contents: read
      issues: write
      pull-requests: write
    uses: ubiquity/deno-deploy-workflow/.github/workflows/deno-deploy-reusable.yml@main
    with:
      project: <subdomain>-ubq-fi
      entrypoint: serve.ts
      prod_branch: development
      # Add build-specific inputs as needed (bun_version, node_version, install_command, build_command, include, runtime_env, build_env)
      project_secrets: |
        SUPABASE_URL=SUPABASE_URL
        SUPABASE_ANON_KEY=SUPABASE_ANON_KEY
    secrets:
      DENO_DEPLOY_TOKEN: ${{ secrets.DENO_DEPLOY_TOKEN }}
```

Notes:
- Use `project_secrets` to forward env vars to the deployment (`SECRET_NAME=ENV_VAR` per line). They are not persisted on Deno Deploy; if you need persistence, set them in the Deploy dashboard.
- Org-level secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) are shared; no repo-specific copies needed.
- Customize `include` for build output dirs (e.g., `static/dist/**`).
- Set `bun_version`/`node_version` and commands for repos with builds. If you use Bun, prefer `bun_version: 1.3.x` (latest as of Dec 2025) instead of older 1.2.x pins.
- To opt out of PR comments, set `comment_pr: false` in `with:`.
- `forward_all_secrets: true` (opt-in) forwards all available GitHub secrets as runtime env vars; defaults exclude `DENO_DEPLOY_TOKEN` and `GITHUB_TOKEN`.
- Secrets managed in GitHub UI—update secret, next deploy forwards it.

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
