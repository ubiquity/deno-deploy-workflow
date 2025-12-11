# Reusable Deno Deploy workflow

This repository provides a standardized, reusable Deno Deploy workflow at `.github/workflows/deno-deploy-reusable.yml` for all ubiquity ubq.fi subdomains. It consolidates deployment patterns across the organization, ensuring consistent CI/CD with shared Supabase secrets and flexible build configurations.

## What it does

- Supports Deno 2.x (default) with configurable versions.
- Optional Node.js and Bun setup for builds (uses official install scripts).
- Configurable install/build commands (multi-line supported).
- Branch-aware deployments: production on specified branch (default: `development`), preview on others.
- Automatic preview project creation if missing.
- Optional project existence check plus project-secret sync via the Deno Deploy API (can read mappings from secrets to avoid code changes).
- Gitignore-based excludes with custom includes for build outputs.
- Runtime env var forwarding (preferred over env_var_keys for simplicity).
- Post-deploy URL verification and HTTP probing, auto-extracting asset paths from your built `index.html` so hashed bundles are probed without manual lists (index file is auto-discovered; override with `index_html_path` only if needed).
- Preflight checks for required secrets (skips deploy if missing).

## How to use (standardized template)

Each ubq.fi subdomain repo now uses this standardized workflow. Add or update `.github/workflows/deno-deploy.yml`:

```yaml
name: Deno Deploy

on:
  push:
  workflow_dispatch:

jobs:
  deploy:
    uses: ubiquity/deno-deploy-workflow/.github/workflows/deno-deploy-reusable.yml@main
    with:
      project: <subdomain>-ubq-fi
      preview_project: <subdomain>-ubq-fi-preview
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
- Use `project_secrets` for env vars synced to Deno project secrets (`SECRET_NAME=ENV_VAR` per line). App reads via `Deno.env.get('SECRET_NAME')`.
- Org-level secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) are shared; no repo-specific copies needed.
- Customize `include` for build output dirs (e.g., `static/dist/**`).
- Set `bun_version`/`node_version` and commands for repos with builds.
- Secrets managed entirely in GitHub UI—update secret, next deploy syncs to Deno.

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
