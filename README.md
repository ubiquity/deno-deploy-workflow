# Reusable Deno Deploy workflow

This repository now includes a reusable, Deno Deploy–ready workflow at `.github/workflows/deno-deploy-reusable.yml`. It merges the patterns from the existing deployments:

- **pay.ubq.fi:** mixed toolchain (Node + Bun + Deno 1.x) with a front-end build before deployctl.
- **uusd.ubq.fi:** explicit preview vs production deployctl targets and the ability to create the preview project if missing.
- **work.ubq.fi:** Deno 2.x, preflight secret checks, env var forwarding, and post-deploy probes to verify the URL/custom domain.

## What it does

- Supports Deno 1.x or 2.x with configurable deployctl version.
- Optional Node and Bun setup for builds.
- Install/build commands are configurable (multi-line ok).
- Preview vs production is branch-aware (default branch = production; everything else = preview). Preview projects can be auto-created.
- Optional `--include`/`--exclude` globs and runtime `--env-var` forwarding.
- Post-deploy domain lookup and HTTP probe (can be toggled with `verify_url`).
- Skips deployment cleanly if required env vars or the deploy token are missing.

## How to use (any repo)

Add a workflow that calls the reusable workflow and forward the secrets/env vars it needs:

```yaml
name: Deploy
on:
  push:
  pull_request:

jobs:
  deno-deploy:
    uses: ubiquity/ubiquity/.github/workflows/deno-deploy-reusable.yml@main
    secrets: inherit # or map explicitly
    env:
      SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
      SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
    with:
      project: audit-ubq-fi
      preview_project: audit-ubq-fi-preview
      entrypoint: server.ts
      root: .
      deno_version: v2.x
      deployctl_version: "1.12.0"
      install_command: |
        bun install
      build_command: |
        bun run build
      env_var_keys: |
        SUPABASE_URL
        SUPABASE_KEY
      include: |
        dist/**
        static/**
      exclude: |
        tests
        cypress
      prod_branch: main
      verify_url: true
      create_preview: true
```

Notes:
- `env_var_keys` lists env vars to forward as `--env-var` during deployment. Provide their values in `env:` (ideally sourced from secrets).
- Use `prod_branch` if the default branch is not `main`.
- Set `node_version` or `bun_version` only if your build requires them.
- Set `deno_version: v1.x` for older code paths (similar to pay.ubq.fi).

## Applying to the undeployed subdomains

Once each project has a deployable entrypoint, wire up a workflow (or copy this file into a dedicated repo for org-wide reuse) with the right project names:

- `audit.ubq.fi` → `project: audit-ubq-fi`, `preview_project: audit-ubq-fi-preview`
- `card.ubq.fi` → `project: card-ubq-fi`, `preview_project: card-ubq-fi-preview`
- `demo.ubq.fi` → `project: demo-ubq-fi`, `preview_project: demo-ubq-fi-preview`
- `keygen.ubq.fi` → `project: keygen-ubq-fi`, `preview_project: keygen-ubq-fi-preview`
- `leaderboard.ubq.fi` → `project: leaderboard-ubq-fi`, `preview_project: leaderboard-ubq-fi-preview`
- `notifications.ubq.fi` → `project: notifications-ubq-fi`, `preview_project: notifications-ubq-fi-preview`
- `onboard.ubq.fi` → `project: onboard-ubq-fi`, `preview_project: onboard-ubq-fi-preview`
- `partner.ubq.fi` → `project: partner-ubq-fi`, `preview_project: partner-ubq-fi-preview`
- `permit2-allowance.ubq.fi` → `project: permit2-allowance-ubq-fi`, `preview_project: permit2-allowance-ubq-fi-preview`
- `safe.ubq.fi` → `project: safe-ubq-fi`, `preview_project: safe-ubq-fi-preview`

Map `entrypoint`, `root`, `install_command`, and `build_command` per project. The workflow can live here (referenced via `uses: ubiquity/ubiquity/.github/workflows/deno-deploy-reusable.yml@main`) or in a new dedicated repo if you want a stand-alone action package.
