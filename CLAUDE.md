# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server on http://localhost:8080
npm run build        # Production build
npm run build:dev    # Build in development mode
npm run lint         # ESLint over the repo
npm run preview      # Preview a production build
npm test             # Run Vitest once
npm run test:watch   # Vitest in watch mode
```

Run a single test file: `npx vitest run src/test/example.test.ts`. Filter by name: `npx vitest run -t "substring of test name"`. Tests use jsdom + Testing Library; global setup is in [src/test/setup.ts](src/test/setup.ts).

The lockfiles are for both `bun` and `npm`; use `npm` (the scripts and CI target it).

## What this app is

A multi-tenant SaaS for car dealerships to measure the ROI of their lead-source **vendors**. Dealerships upload/receive **leads** and **sales**, the app **attributes** each sale back to the vendor that generated the originating lead, and reports cost-per-lead, close rate, revenue, and ROI per vendor — classifying each vendor as CUT / OPTIMIZE / SCALE.

Core domain flow: `vendor` (a paid lead source with a `monthly_cost`) → `leads` (imported via CSV or the public webhook) → `sales` (imported via CSV) → **attribution** matches a sale to a lead/vendor using normalized email, phone, VIN, stock number, and name.

## Architecture

Single-page React app (Vite + React 18 + TypeScript), Supabase for auth/DB/edge functions, deployed on Vercel as a static SPA.

- **Frontend**: [src/App.tsx](src/App.tsx) declares all routes. Every app route is wrapped in `<ProtectedRoute>` + `<AppLayout>`. `ProtectedRoute` gates on auth and optionally a `requireRole` (`admin`). The root `/` renders `RoleRouter`, which sends admins to `/admin` and clients to the `ClientDashboard`.
- **Path alias**: `@/` → `src/` (configured in vite/vitest/tsconfig).
- **UI**: shadcn/ui components live under [src/components/ui/](src/components/ui/) (generated — avoid hand-editing; regenerate via the shadcn CLI, config in [components.json](components.json)). App-specific components are one level up in `src/components/`. Styling is Tailwind with CSS-variable theme tokens (`hsl(var(--...))`); prefer those tokens over hardcoded colors.
- **Data layer**: no REST layer of our own — pages call the Supabase client ([src/integrations/supabase/client.ts](src/integrations/supabase/client.ts)) directly and hold results in local state. `@tanstack/react-query` is installed but most pages fetch imperatively in a `load()` effect. [src/integrations/supabase/types.ts](src/integrations/supabase/types.ts) is generated from the DB schema — do not hand-edit; regenerate from Supabase.

### Auth & tenancy (read before touching data code)

Two React contexts, both mounted in `App.tsx`, drive nearly every page:

- **`useAuth`** ([src/hooks/useAuth.tsx](src/hooks/useAuth.tsx)) — session, `profile`, and `roles`. Roles (`admin` | `client`) live in a separate `user_roles` table, never on the profile. Note the deliberate ordering in the auth effect: register `onAuthStateChange` *first*, defer Supabase calls inside it with `setTimeout(0)`, *then* call `getSession()` — this avoids a Supabase deadlock. Preserve this pattern.
- **`useActiveOrg`** ([src/hooks/useActiveOrg.tsx](src/hooks/useActiveOrg.tsx)) — the currently selected organization (dealership). Admins see all orgs; clients see the orgs listed in `user_organizations` (a user can belong to several). The selection persists in `localStorage` under `vroi.activeOrgId`.

**Almost every query must be scoped with `.eq('organization_id', activeOrgId)`.** Guard on `if (!activeOrgId) return;` before fetching. Forgetting the org filter leaks another dealership's data. RLS enforces this server-side too, but client code is expected to scope explicitly.

### Backend: Supabase

- **Migrations**: [supabase/migrations/](supabase/migrations/) — SQL schema plus Row Level Security. Multi-tenancy uses `SECURITY DEFINER` helper functions (e.g. `has_role`) to avoid RLS recursion. Key tables: `organizations`, `profiles`, `user_roles`, `user_organizations`, `vendors`, `leads`, `sales`, `api_credentials`.
- **Edge functions** ([supabase/functions/](supabase/functions/), Deno):
  - `receive-leads` — public webhook for external CRMs to POST leads. Authenticated via an `x-api-key` header matched against `api_credentials`; uses the service-role key and maps many field-name aliases into the `leads` schema.
  - `invite-user` — user invitation flow.

### CSV import & normalization

CSV upload pages (`Upload`, `SalesUpload`, `InventoryUpload`) parse with `papaparse` and rely on [src/lib/normalize.ts](src/lib/normalize.ts) for all the fuzzy/matching logic. When touching import or attribution, reuse these — don't reinvent them:

- `normalizePhone` / `normalizeEmail` / `normalizeName` — canonical matching keys.
- `buildDedupHash` — deterministic SHA-256 dedup key from email/phone/name/vehicle/VIN/stock/date.
- `guessColumn` — word-boundary fuzzy header matching for the CSV column mapper.
- `normalizeRevenue`, `parseLeadDate`, `parseVehicle`, `looksNonHuman` — value coercion/validation.

Note: `receive-leads/index.ts` and `receive-sales/index.ts` reimplement `normalizePhone`/`normalizeEmail`/etc. locally because Deno edge functions can't import from `src/`. Keep them in sync with `src/lib/normalize.ts` if you change the normalization rules. `receive-sales` is a public webhook (same `x-api-key` auth pattern) meant for scheduled scripts (Task Scheduler/cron) pushing a sales export — it dedupes via the `sales.dedup_hash` unique index and calls `attribute_sales_for_org` after insert.

CSV export goes through `downloadCsv` in [src/lib/exportCsv.ts](src/lib/exportCsv.ts).

## Environment

Client env vars are Vite-style (`VITE_` prefix), read via `import.meta.env`:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` (in `.env`). Edge functions read `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the Deno environment.

## Conventions

- `@typescript-eslint/no-unused-vars` is intentionally off; the `react-hooks` rules are on — respect the exhaustive-deps warnings.
- User feedback uses `sonner` toasts (`import { toast } from 'sonner'`), typically `toast.error('... ' + err.message)` on failed queries.
- Charts use `recharts`; money is formatted with `toLocaleString('en-US', { style: 'currency', currency: 'USD' })`.
- Deployment is a static SPA on Vercel; [vercel.json](vercel.json) rewrites all paths to `/index.html` for client-side routing.
