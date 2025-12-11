# Ubiquity Subdomain Deploy Notes

- All subdomain apps share the same Supabase project; use the org-level GitHub secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY` (already defined). Do **not** customize per-repo values.
- Deno Deploy workflows must include `serve.ts` and `deno.json` in `deployctl --include` alongside `static/**` so the entrypoint and config ship with the bundle.
- Prefer the inline Deno Deploy workflow pattern already rolled out (setup Deno 2.x, install Bun via the curl script, install deployctl, `bun run build`, then `deployctl deploy` with prod flag on the default branch).
- If a build step needs Supabase env vars, feed them via `build_env`/`env` from the org secrets; runtime env is not required for static sites.
- Site router (`lib/ubq.fi-router`, Cloudflare Worker) is deterministic: `ubq.fi` → `ubq-fi.deno.dev`, `<sub>.ubq.fi` → `<sub>-ubq-fi.deno.dev`; plugins `os-<plugin>[{-main|-dev|-development}].ubq.fi` → `<plugin>-{main|development}.deno.dev`; `/rpc/:chainId` proxies to `https://rpc.ubq.fi/:chainId` same-origin. No KV or fallback; it streams upstream status/headers.
- Deno Deploy project names must end with `-ubq-fi` to match the router’s `<sub>-ubq-fi.deno.dev` mapping. Preview hostnames `preview-<sub>.ubq.fi` route to Deno projects `p-<sub>-ubq-fi`, clamped to 26 chars with truncation + short hash; router maps `preview-<sub>.ubq.fi` → `https://p-<sub>-ubq-fi.deno.dev`.
- Local hygiene: run `./scripts/lint-actions.sh` before commits (optional local pre-commit hook in `.git/hooks/pre-commit`; mark executable). It installs actionlint to `.tools/` and lints workflows in the root plus `lib/notifications.ubq.fi` by default; override with `ACTIONLINT_PATHS`/`ACTIONLINT_FLAGS` as needed. `.tools/` is gitignored.
- Some repos block reusable workflows; fall back to an inline workflow per repo and make sure build/runtime env vars are present (Supabase URL/anon key, BACKEND_URL/FRONTEND_URL where used).
- Deno Deploy enforces per-hour deployment limits; when pushing several sites back-to-back, expect to rerun the failed jobs after the cooldown rather than editing code.
- Always include the repo root (`--include="."`) so the entrypoint and `deno.json` ship; build excludes should come from `git ls-files --ignored --exclude-standard`, with per-repo exceptions to keep gitignored build outputs that must deploy (e.g., `static/dist/**`, `dist/**`, `out/**`, `static/bundles/**`, or `public/app.js*`).
- Use the repo default branch as the production gate; let deployctl include the repo root and build a gitignore-based exclude list, skipping gitignored build artifacts that must ship (e.g., `public/app.js` in `uusd.ubq.fi`).
- Process discipline: after changing a repo, wait for that repo’s deploy run to succeed before adding lessons here—only propagate guidance that has been validated by a successful deployment so later sub-projects inherit proven steps.
- Per-project nuance: `lib/pay.ubq.fi` builds the frontend in `frontend/` and serves from `frontend/dist` via `serve.ts`; workflow should run `bun install && bun run build` inside `frontend`, include `frontend/dist/**`, and set runtime `STATIC_DIR=frontend/dist` with build env `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (no `static/**` path there).
- Repo layout note: `lib/` contains working copies of the subdomain projects (health, onboard, pay, etc.); leave unrelated local changes there untouched unless explicitly working on that subproject.
- Cloudflare WAF bypass: Uses WAF custom rule with skip action for requests with `x-ci-token` header matching `CI_PROBE_TOKEN` org secret; skips managed rules, rate limiting, and bot fight for CI probes; rule created/deleted per workflow run.
  - Header-based custom rule (x-ci-token) skips managed rules/rate limiting/bot fight via /rulesets/phases/http_request_firewall_custom/entrypoint API.
  - Requires token with Zone:Read + Zone WAF:Read/Edit; "all zones" may not grant Read—scope to specific account/zone for security.
  - Local tests pass (200 after ~30s propagation), but Actions fail on ruleset fetch (403/unauthorized) if token lacks Read.
  - Fallback: Zone-level IP access rules if lists/WAF edit insufficient; use CI_PROBE_TOKEN as org secret (visibility: all).
  - Propagation: 30s sleep works; poll /health with header every 250ms for precise timing.
  - Cleanup: DELETE /rules/{rule_id} fails with API token (use Global API Key for delete if needed).
- GitHub Actions / deployctl tips:
  - When exporting multiline env vars (e.g., debug fetch paths), use a heredoc into `$GITHUB_ENV` (`DEBUG_FETCH_PATHS<<EOF … EOF`); writing `DEBUG_FETCH_PATHS=$lines` fails with `Invalid format '<path>'`.
  - deployctl occasionally returns `Unexpected token '<' ... is not valid JSON` during upload (Deno API returns HTML). Treat as transient: rerun after a short delay; issue seen on initial preview creation.

## Deno Deploy Debugging Notes

- If deployment succeeds but probe returns HTTP 000 or 404, check: project name ends with `-ubq-fi`, build_env uses `$VAR` syntax (not `${{ secrets.VAR }}`), runtime_env includes `STATIC_DIR=static`, include covers `static/**` (for index.html and dist), serve.ts has SPA fallback to serve index.html for non-file 404s.
- Build outputs to `static/dist`, but index.html is in `static/`, so STATIC_DIR=static and include static/**.
- For SPA apps, serve.ts must handle client-side routing by falling back to index.html on 404 for paths without extensions.
- Linter enhancements: yamllint with GitHub Actions schema for validation; run `./scripts/lint-actions.sh` to check workflows.
