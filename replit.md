# Flash Focus

Flash Focus is a 60-second Stroop-inspired attention game with a privacy-safe shared competition leaderboard.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Flash Focus public build env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/flash-focus/src/App.tsx` — gameplay, screens, local offline cabinet, and competition UI
- `artifacts/flash-focus/src/lib/competition-api.ts` — anonymous Supabase session and Edge Function client
- `artifacts/flash-focus/src/index.css` — Flash Focus visual system and responsive layout
- `supabase/migrations/20260922000000_flash_focus_competition.sql` — competition tables, indexes, seed competition, and RLS
- `supabase/functions/flash-focus/index.ts` — authenticated session, score validation, leaderboard, rate limiting, and deletion endpoint

## Architecture decisions

- The browser never writes scores directly to Postgres. It submits a signed anonymous session plus round events to the Supabase Edge Function, which recalculates the score.
- RLS intentionally denies direct client table access; public leaderboard data is projected through the Edge Function to approved fields only.
- The localStorage cabinet is an offline/cache fallback, not the source of truth for shared competition results.
- Anonymous Auth must be enabled in Supabase Authentication → Providers; this hosted setting cannot be enabled through the SQL migration.

## Product

- Each round independently assigns INK COLOR or WORD COLOR from a balanced 70/30 sequence, with no more than four identical rules in a row.
- One-minute sessions include streak multipliers, speed bonuses, Borderless Moments, separate sound/rule-announcement/coach controls, and accessible keyboard controls.
- Shared leaderboard scopes include Top 10, Top 100, My Rank, This Week, and All Time.
- Nickname validation rejects identifying/contact-like strings and the participant can remove their leaderboard entry.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Before testing shared scoring, enable Anonymous Sign-Ins in the Supabase dashboard and ensure the `flash-focus` Edge Function has JWT verification enabled.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only. Only the publishable key may be exposed through `VITE_` variables.
- Exact disclaimer text is part of the start and results UI and the README; preserve it when editing copy.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
