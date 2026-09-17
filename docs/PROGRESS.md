# Progress log

Newest first. One entry per finished roadmap task: date, task, what changed, how it was verified.

## Log

- **2026-09-17**: Phase 0 — **E2E harness**. Playwright in the repo (`npm run e2e`, `npm run e2e:ci`) with helpers and specs for register → practice trade → settles → history, the crypto deposit invoice flow, admin approving a withdrawal, back-office section loads, the admin-guard redirect, and a responsive pass that asserts no console errors and no horizontal scroll at 1440px and on a Pixel 7. 11 specs green. Wired into CI (browser install + report artifact). Found and fixed a real mobile overflow: the admin support grid children had default `min-width: auto`, so a long message widened the page by 119px at 390px.
- **2026-09-17**: Phase 0 — **Lint and format**. ESLint 9 flat config (typescript-eslint, react-hooks, jsx-a11y) + Prettier, `npm run lint` / `npm run format:check` at the root, zero warnings, both in CI. Fixed every finding rather than silencing it: expiry/investment groups became `fieldset`/`legend`, the admin drawer and mobile market sheet got real backdrop buttons plus Escape-to-close, the realtime handler map dropped its `any`, and stale eslint-disable directives went. Repo formatted (owner-authored markdown left alone).
- **2026-09-17**: Phase 0 — **Error boundaries**. `components/ErrorBoundary.tsx` with a page variant (reload + retry) and an inline variant; wrapped around the public routes, the trader shell outlet, the admin shell outlet and the terminal chart, keyed on the route so navigation clears a failure. 5 unit tests (jsdom + @testing-library/react, new `web/vitest.config.ts`) covering catch, reporting, inline isolation and reset-key recovery.
- **2026-09-17**: Phase 0 — **Fix seed env loading**. Added `server/src/lib/load-env.ts`, which resolves `server/.env` from the module path (then falls back to `cwd/.env`), and imported it from `env.ts` and `seed.ts`. `npm run seed` now works from the repo root and from `server/` without relying on Prisma's implicit env loading. Verified from both directories with `DATABASE_URL` unset in the shell.

- **2026-09-17**: Fixed the terminal crash when two or more trades are open (chart markers sorted by time). Added the skeleton loading kit across app and admin. Added five design mockups and the PHP theme browser. Verified with typecheck, build, web tests, and a headless browser placing five consecutive trades with no errors.

## Decisions

_Record product choices made without the owner here: what, why, where it's configurable._

- **E2E browser binary**: `playwright.config.ts` honours `E2E_CHROMIUM_PATH` so sandboxes with a pre-installed Chromium don't download another. CI installs the pinned browser and ignores the variable.
- **Prettier scope**: code only. `*.md` is ignored so the owner's docs keep their own formatting.

## Blocked on owner

_Things that need real credentials, legal text, or a business decision._

- Which mockup direction becomes the primary theme preset.
- Payment provider accounts (card gateway, e-wallets) and production custody provider.
- Legal texts (terms, privacy, risk disclosure, AML policy) and licensing jurisdiction.
