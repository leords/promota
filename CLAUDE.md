# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A multi-tenant SaaS for managing field promoter teams and point-of-sale execution in
Brazil (routes, check-in/out, price collection, photos, surveys, events, expiration
tracking). Mobile-first PWA for promoters in the field (offline-first), desktop for
managers. Full spec and phased roadmap live in `docs/` — read `docs/NEXT_STEPS.md`
first to see what phase is active, and `docs/DECISIONS.md` before revisiting an
architectural choice someone already made a call on.

## Repo layout

```
apps/web/   React + TypeScript + Vite + PWA (vite-plugin-pwa) — frontend
apps/api/    Node + TypeScript + Express — REST API
data/schema.sql   canonical DB schema: `platform` schema (tenants, super admins) + `app` schema (tenant data, RLS-protected)
infra/       docker-compose.yml — PostgreSQL 16 + PostGIS
```

Each app subfolder has its own `package.json` — no root workspace config by design,
treat `apps/web` and `apps/api` as separate deployable projects.

## Commands

```bash
# database (host port 5433, not 5432 — see below)
docker compose -f infra/docker-compose.yml up -d
docker exec -i promota-db psql -U promota -d promota < data/schema.sql

# seed the first tenant + admin user (uses the superuser connection string)
cd apps/api
MIGRATE_DATABASE_URL="postgres://promota:promota@localhost:5433/promota" \
  npm run seed -- --slug acme --nome "Acme" --admin-email admin@acme.com --admin-senha x

# api — health at /health, login at POST /auth/login
npm install && npm run dev     # tsx watch
npm run build                  # tsc -> dist/
npm run lint                   # tsc --noEmit

# web — Vite defaults; npm run build also emits sw.js/manifest.webmanifest (vite-plugin-pwa)
npm install && npm run dev
```

No automated tests yet in either app.

## Architecture notes that aren't obvious from file layout

- **Multi-tenancy is enforced by Postgres Row-Level Security, not just app-level
  `WHERE tenant_id = ...`.** Every operational table in the `app` schema has
  `tenant_id` + a `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`
  policy with `FORCE ROW LEVEL SECURITY`. `apps/api/src/db/pool.ts`'s `withTenant()`
  wrapper is the only sanctioned way to touch `app.*` tables — it does
  `SELECT set_config('app.tenant_id', $1, false)` on a dedicated connection before
  running the query. **`SET app.tenant_id = $1` does NOT work** — `SET` doesn't accept
  bind parameters, only `set_config()` does; this broke login once during setup.
- **RLS is silently bypassed for Postgres superusers**, regardless of
  `FORCE ROW LEVEL SECURITY`. The API must connect as `app_runtime` (created in
  `data/schema.sql`, `NOBYPASSRLS`), never as the `POSTGRES_USER` superuser. Migrations
  and the seed script use the superuser (`MIGRATE_DATABASE_URL`); runtime API traffic
  uses `app_runtime` (`DATABASE_URL`). Don't collapse these into one connection string.
- **No `tenant_id` set → zero rows, not "unfiltered."** This was verified directly
  against the database during setup (see `docs/NEXT_STEPS.md`) — treat any change to
  the RLS policies as needing that same verification, not just a passing typecheck.
- **New operational tables need `tenant_id` + an RLS policy before they ship** — this
  is a hard checklist item (`docs/RISKS.md`), not a nice-to-have.
- **Login takes a `tenantSlug`**, not just email/password — multi-tenant means the
  same email can exist in different tenants (`app.users` unique constraint is
  `(tenant_id, email)`, not `email` alone). The frontend login form has a
  company-slug field for this reason; don't "simplify" it away.
- **Async Express route handlers must go through `asyncHandler`**
  (`apps/api/src/middleware/asyncHandler.ts`). Express 4 does not forward rejected
  promises to the error middleware on its own — an unhandled rejection here crashes
  the whole Node process, not just the request (this happened once during setup).
- **Offline-first foundation is already in place, not yet wired to real features.**
  `apps/web/src/offline/db.ts` (IndexedDB via `idb`) and `syncQueue.ts` (client-generated
  UUIDs for idempotent server upserts) exist so Fase 2 features (check-in, price
  collection, photos, occurrences) can enqueue into them — implement each feature's
  queue integration when that feature is built, don't design a new offline mechanism
  per feature.
- **Business rule: never rank promoters by raw activity volume.** The spec explicitly
  forbids a productivity ranking or "execution quality index" — dashboards in Fase 3
  must contextualize numbers (route size, PDV complexity), not sort promoters by
  visit count. This is a product requirement, not a suggestion.
- **Dev-only port choices**: Postgres on host `5433` (not `5432`) and API on `3334`
  (not `3001`/`3000`) — this machine already runs another Postgres/Supabase stack on
  `5432` and something else on `3001`. Check `netstat`/`Get-NetTCPConnection` before
  assuming a "standard" port is free here; don't "fix" these back to defaults.

## Fase 2 (operação) notes

- `data/schema_02_operacao.sql` adds `pdvs`, `products`, `routes`, `route_pdvs`,
  `visits`, `photos`, `price_collections` — apply after `data/schema.sql`. Same RLS
  pattern (`tenant_id` + `FORCE ROW LEVEL SECURITY` + policy), granted to
  `app_runtime`.
- `visits`, `photos`, and `price_collections` all have a `client_id UUID UNIQUE`
  column — this is the offline-sync idempotency key (see
  `apps/web/src/offline/syncQueue.ts`). The API upserts by `client_id`, not by
  primary key, on these three endpoints specifically (`POST /visits/checkin`,
  `POST /photos`, `POST /price-collections`) — don't add a plain `INSERT` there.
- Check-in distance to the PDV is computed in SQL via `ST_Distance` against
  `pdvs.geom`, not client-side — the client only sends raw lat/lng.
- **Photo storage is disk-backed (`apps/api/uploads/`) for dev only** — flagged
  explicitly in `routes/photos.ts` and `docs/DECISIONS.md` as not production-ready
  (container disk isn't durable). Don't treat this as the final design; a real
  provider (S3/R2/etc.) still needs to be chosen with the user.
- The web app's `RouteToday.tsx` decodes the JWT client-side
  (`auth/decodeToken.ts`) purely to pick which screen to show (promoter vs. manager
  shell) — this is a UI convenience only, never a security boundary; every route
  still enforces role/tenant server-side.
- Verified in a real browser (not just `tsc`/build): login → check-in → price
  collection → check-out, with the route status progressing
  `pendente → em_atendimento → concluido`, plus idempotent check-in retry and
  cross-tenant 404 on `/pdvs/:id`. Offline-queue draining has **not** yet been
  exercised with the network actually cut in a browser — only reviewed by reading
  the code path. Don't claim that's validated without doing it first.

## Management screens (admin/gerente)

- `apps/web/src/pages/admin/` holds `AdminLayout` + `PdvsPage`/`ProductsPage`/`RoutesPage`.
  Routing in `App.tsx` sends `promotor` to `RouteToday`, everyone else to `/pdvs`
  under `AdminLayout` — this split is by decoded JWT role (`decodeTokenRole`, UI-only,
  never a security boundary).
- **`app.routes.status` is a derived/rollup field, not independently settable.**
  `apps/api/src/services/routeStatus.ts`'s `refreshRouteStatus(client, routeId)`
  recomputes it from `route_pdvs.status` after every check-in, check-out, or
  "não atendido" write. If you add a new way to change a `route_pdvs` row's status,
  call `refreshRouteStatus` in the same transaction — this was a real bug (status
  stuck on `planejada` forever) caught only by testing in an actual browser, not by
  typecheck.
- `GET /routes` (list, admin/gerente/supervisor) and `GET /users?role=` (for the
  promoter picker when creating a route) exist alongside the promoter-facing
  `GET /routes/today`.

## Offline sync — hard-won lessons from testing with the network actually cut

- **`INSERT ... ON CONFLICT (client_id) DO NOTHING`, never `SELECT` then `INSERT`,
  for any endpoint idempotent by client-generated UUID** (`visits.ts` checkin,
  `priceCollections.ts`, `photos.ts`). The select-then-insert pattern has a real
  TOCTOU race — reproduced in an actual test session (server log:
  `duplicate key value violates unique constraint "visits_client_id_key"`) when two
  concurrent requests with the same `clientId` both passed the SELECT before either
  inserted. One got a 500, and the client's sync queue then marked a check-in
  "failed" that had, in fact, already been saved by the other request. Follow this
  pattern for any new idempotent-by-`client_id` endpoint.
- **`apps/web/src/pages/RouteToday.tsx`'s `reload()` must never blindly
  `setRoute(null)` on a failed refetch.** Only a confirmed 404 from the server means
  "no route today" — any other error (offline, server down) must leave the
  previously-loaded/cached route in place. Getting this wrong was a real bug found
  while testing: losing connectivity made the promoter's route disappear entirely,
  the opposite of what Offline First is for.
- **The last successfully-fetched route is cached in `localStorage`**
  (`offline/localKeys.ts` → `CACHED_ROUTE_KEY`), hydrated on mount, so opening the
  app already offline still shows the route (not just surviving a mid-session drop).
  Cleared on logout to avoid leaking one tenant's cached route into the next login on
  the same device.
- **After a queued check-in syncs, the client must learn the real server-assigned
  `visitId`.** `offline/activeVisits.ts`'s `resolveActiveVisit(clientId, visitId)`,
  called from `syncManager.ts` right after a successful check-in sync, does this.
  Without it (a real bug found while testing), the local record keeps `visitId: ""`
  forever, and the promoter can never check out of that PDV even though the
  check-in landed fine server-side.
- When testing this stuff yourself: stopping the API process is a more honest offline
  test than only flipping `navigator.onLine` — the latter doesn't make `fetch` fail,
  it only changes what the UI *displays*. Use both together (see the online/offline
  indicator wiring in `offline/useSync.ts`).

## Photos, file serving, and a real Express routing gotcha

- **Never serve user-uploaded files (photos, or anything similar added later) via
  `express.static` or any other unauthenticated static path.** `GET
  /photos/:id/file` (`apps/api/src/routes/photos.ts`) is the pattern: look the record
  up through `withTenant()` first (RLS enforces tenant ownership), only then
  `res.sendFile(...)`. This replaced an actual security bug found while testing the
  photo gallery — `/uploads` was `express.static`, serving any tenant's photo to
  anyone with the (UUID, not secret) filename.
- **Frontend fetches photos authenticated and renders via blob URL**
  (`api/admin.ts` → `fetchPhotoBlobUrl`, used in `pages/admin/PdvDetail.tsx`) — a
  plain `<img src="...">` can't send an `Authorization` header, so there's no way to
  point it directly at an authenticated endpoint. Revoke the object URL on unmount
  (already done) to avoid leaking memory.
- **Every feature router is mounted with `app.use(someRouter)` at no path prefix,
  and each calls `someRouter.use(requireAuth)` before its own routes.** That
  `.use(requireAuth)` matches *any* request that reaches it in the middleware chain,
  not just that router's own declared paths — this is what caused the original
  `/uploads` bug to manifest as a silent 401 instead of an obvious error (an `<img>`
  tag sends no `Authorization` header, so the first auth-gated router in the chain
  rejected it before `express.static` was ever reached). Keep this in mind before
  adding another global, no-prefix router with its own auth middleware.
  **This recurred once already** — `dashboardRouter.use(requireAuth,
  requireRole(...))` and `reportsRouter.use(requireAuth, requireRole(...))` in Fase 4
  blocked promoters with 403 on unrelated routes (`GET /surveys/active`,
  `GET /events/mine`) mounted later in `index.ts`, despite this exact pitfall already
  being written down here. `router.use(requireAuth)` alone (no role) is fine — every
  route needs auth, so leaking to the whole chain is harmless. The moment you add
  `requireRole(...)` to a router-level `.use()`, put it on the individual route(s)
  instead. Check every new router against this before moving on, don't rely on
  remembering it.

## Fase 3 (gestão e inteligência) notes

- `data/schema_03_gestao.sql` adds `occurrences` — same RLS + `client_id` idempotency
  pattern as `visits`/`photos`/`price_collections`. Dashboard, map, and the coverage
  detector are all queries over existing tables (`pdvs`, `visits`, `route_pdvs`), not
  new tables.
- **`GET /dashboard/today` deliberately never ranks promoters by activity volume** —
  the spec explicitly forbids a productivity ranking. If you're tempted to add a
  "top promoters" widget, don't; the aggregates here are operational counts, not
  individual evaluation.
- **Coverage detector** (`pdvsSemCobertura` in the dashboard response) only flags a
  PDV if `frequencia_esperada_dias` is set — it existed in the schema since Fase 1
  but was never exposed via the API/UI until this pass. It compares against the most
  recent `visits.checkin_em` for that PDV, falling back to `pdvs.criado_em` if never
  visited — verified by directly backdating a visit's `checkin_em` in the DB and
  confirming the PDV appeared/disappeared from the list accordingly.
- **PATCH endpoints can't clear a field, only set one.** `UPDATE ... SET x =
  COALESCE($n, x)` means there's no way to un-assign `promotor_responsavel_id` from a
  PDV via `PATCH /pdvs/:id` — the driver collapses "not sent" and "sent as null" into
  the same SQL NULL. Not data-corrupting, just a no-op UI action. See `docs/RISKS.md`
  before "fixing" one endpoint in isolation — this needs a single pass across all
  `PATCH` handlers, not a one-off.
- `apps/web/src/pages/admin/MapaPage.tsx` uses raw Leaflet (not react-leaflet) with
  `L.circleMarker` (not `L.marker`) specifically to avoid Leaflet's default marker
  icon asset-path problem under Vite bundling — don't switch to icon markers without
  handling that.

## Fase 4 (recursos avançados) notes

- `data/schema_04_avancado.sql` adds validades (`expiration_settings` +
  `expiration_records`), pesquisas (`surveys`/`survey_questions`/`survey_responses`/
  `survey_answers`), and eventos (`events`/`event_promoters`/`event_products`/
  `event_results`) — same RLS + `client_id` idempotency pattern as everything else.
- **`DATE` columns need `to_char(col, 'YYYY-MM-DD')` in the query, every time.**
  This was already fixed once for `app.routes.data` in Fase 2 and had to be fixed
  again for `expiration_records.data_validade` and `events.data` (three separate
  queries) in Fase 4 — `pg` returns `DATE` as a JS `Date` at midnight UTC, and
  JSON-serializing that gives a full ISO timestamp, not a clean date. There's no
  central place this is handled; check every new query selecting a `DATE` column.
- **CSV report dates**: fixed once, centrally, in `apps/api/src/services/csv.ts`'s
  `formatCsvValue` — it special-cases `instanceof Date` to format as
  `YYYY-MM-DD HH:MM:SS` instead of relying on `String(value)`, which would otherwise
  produce JS's verbose `Date.toString()` output. Any new CSV report automatically
  gets this by going through `toCsv()`; don't format dates manually per-report.
- **Survey answers are stored as plain `TEXT`, typed by convention via
  `survey_questions.tipo`**, not by a JSONB/typed column per question type —
  `multipla_escolha` answers are a JSON-array-encoded string. `SurveysPage.tsx`'s
  response viewer currently prints that raw JSON string rather than a formatted list
  — noted as cosmetic in `docs/NEXT_STEPS.md`, not fixed yet.
- **`foto`-type survey questions accept the question but don't collect an image** —
  deliberate scope cut (see `docs/DECISIONS.md`), not a bug. `SurveyAnswerModal.tsx`
  shows a "not supported yet" message for that question type instead of blocking the
  rest of the form even when the question is marked required.
- **Events are deliberately a separate UI section from the daily route**
  (`pages/MyEvents.tsx`, rendered below the route list in `RouteToday.tsx`, not
  merged into it) — the spec is explicit that events aren't a route.
- CSV downloads (`ReportsPage.tsx`) go through `downloadAuthenticated()` in
  `api/client.ts` (fetch + blob + temporary `<a>` click), the same reason photos use
  a blob URL — a plain `<a href>` can't carry the `Authorization` header.

## Notifications (Resend)

- `data/schema_05_notificacoes.sql` adds `app.notifications` (the log — doubles as
  the Seção 14 "in-system notification", written even when no email goes out) and
  `app.pdvs.notificar_email` (explicit opt-in, never assume a PDV wants its email
  notified).
- **Channel is isolated in `services/email.ts`; the decision logic in
  `services/notifications.ts` never imports the Resend SDK directly.** Swapping
  providers or adding a channel means touching `email.ts`, not who-to-notify logic.
- **No `RESEND_API_KEY` → logs to console and returns `{ sent: false }`, doesn't
  throw** — lets the rest of the system run in dev/CI without a real account. The
  notification log then correctly shows status `pulada`, not `enviada` — don't
  "simplify" this back to always recording `enviada` optimistically; that would lie
  about what actually happened.
- **A plain `UNIQUE` constraint can't dedupe rows where the differentiating column is
  sometimes `NULL`** (SQL treats every `NULL` as distinct from every other `NULL`).
  `app.notifications` uses two *partial* unique indexes instead (one for
  `destinatario_user_id IS NOT NULL`, one for `IS NULL`) — and because of that,
  `ON CONFLICT DO NOTHING` **must** name the exact index (including its `WHERE`)
  per case; a bare `ON CONFLICT DO NOTHING` throws `42P10` when there are multiple
  partial unique indexes it could ambiguously match. See
  `services/notifications.ts`'s `notifyOnce` for the pattern if you add another
  notification type.
- Notification dispatch is fired from `routes/expirations.ts` on a **separate**
  `withTenant()` connection, un-awaited from the response but with an explicit
  `.catch()` — never block the promoter's request on email delivery, and never leave
  an unhandled promise rejection (that specific mistake already crashed the process
  once in Fase 1; don't reintroduce it here).

## Working style for this repo

Follow the phase order in `docs/NEXT_STEPS.md` (Fase 1 fundação → Fase 2 operação →
Fase 3 gestão/inteligência → Fase 4 recursos avançados) — don't jump ahead. Before
deciding something with recurring cost or that's hard to reverse later (photo storage
provider, email provider — both flagged as pending in `docs/DECISIONS.md`), ask rather
than picking unilaterally, per the project's own stated autonomy rule.
