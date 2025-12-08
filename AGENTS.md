# Ubiquity Subdomain Deploy Notes

- All subdomain apps share the same Supabase project; use the org-level GitHub secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY` (already defined). Do **not** customize per-repo values.
- Deno Deploy workflows must include `serve.ts` and `deno.json` in `deployctl --include` alongside `static/**` so the entrypoint and config ship with the bundle.
- Prefer the inline Deno Deploy workflow pattern already rolled out (setup Deno 2.x, install Bun via the curl script, install deployctl, `bun run build`, then `deployctl deploy` with prod flag on the default branch).
- If a build step needs Supabase env vars, feed them via `build_env`/`env` from the org secrets; runtime env is not required for static sites.
- Site router (`lib/ubq.fi-router`, Cloudflare Worker) is deterministic: `ubq.fi` → `ubq-fi.deno.dev`, `<sub>.ubq.fi` → `<sub>-ubq-fi.deno.dev`; plugins `os-<plugin>[{-main|-dev|-development}].ubq.fi` → `<plugin>-{main|development}.deno.dev`; `/rpc/:chainId` proxies to `https://rpc.ubq.fi/:chainId` same-origin. No KV or fallback; it streams upstream status/headers.
- Deno Deploy project names must end with `-ubq-fi` to match the router’s `<sub>-ubq-fi.deno.dev` mapping. Preview projects should be prefixed `preview-<slug>-ubq-fi` so previews resolve while preserving the `-ubq-fi` suffix.
- Some repos block reusable workflows; fall back to an inline workflow per repo and make sure build/runtime env vars are present (Supabase URL/anon key, BACKEND_URL/FRONTEND_URL where used).
- Deno Deploy enforces per-hour deployment limits; when pushing several sites back-to-back, expect to rerun the failed jobs after the cooldown rather than editing code.
- Always include the repo root (`--include="."`) so the entrypoint and `deno.json` ship; build excludes should come from `git ls-files --ignored --exclude-standard`, with per-repo exceptions to keep gitignored build outputs that must deploy (e.g., `static/dist/**`, `dist/**`, `out/**`, `static/bundles/**`, or `public/app.js*`).
- Use the repo default branch as the production gate; let deployctl include the repo root and build a gitignore-based exclude list, skipping gitignored build artifacts that must ship (e.g., `public/app.js` in `uusd.ubq.fi`).
