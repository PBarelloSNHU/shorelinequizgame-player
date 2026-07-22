# Trolley Quiz 357 — starter code

Runnable skeleton for the Supabase Realtime-only architecture (host-client +
player-client static apps, Postgres/Realtime as the entire backend — no
Node/Socket.io server). See the architecture doc for the full design
rationale; this is the code that implements it.

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run `supabase/migrations/0001_init.sql`, then `supabase/seed.sql`.
3. Under **Authentication > Providers**, make sure **Anonymous sign-ins** are enabled — both apps rely on `signInAnonymously()` for a stable per-device identity.
4. Under **Project Settings > API**, copy your Project URL and `anon` public key.

## 2. Configure the two apps

```bash
cp host-client/.env.example host-client/.env
cp player-client/.env.example player-client/.env
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in both `.env` files.
In `host-client/.env`, also set `VITE_PLAYER_URL` once you know where the
player app will be deployed (used to build the QR code target).

## 3. Run locally

```bash
cd host-client && npm install && npm run dev     # http://localhost:5173
cd player-client && npm install && npm run dev   # http://localhost:5174
```

Open the host app, create a session, then open the player app in another
tab (or on your phone once deployed) and join with the code shown on screen.

## 4. Deploy

Both apps are plain static builds:

```bash
npm run build   # outputs to dist/
```

Push this repo to GitHub as a **private repo**, then deploy `host-client/`
and `player-client/` as two separate static sites (GitHub Pages, Netlify,
Vercel, or Cloudflare Pages all work — no server process to keep running).
Set the same environment variables in each platform's dashboard.

## Troubleshooting

- **`ERROR: 42501: must be owner of table messages` when running the
  migration.** This means the SQL editor tried to run
  `alter table realtime.messages enable row level security;`. That line has
  been removed from `0001_init.sql` — `realtime.messages` is a
  Supabase-internal table with RLS already enabled by default, and no role
  available in the SQL editor owns it, so the `ALTER TABLE` itself always
  fails. If you're re-running an older copy of the migration, delete that
  one line and re-run; the `CREATE POLICY` statements below it are fine to
  run as-is. See [Supabase's Realtime Authorization docs](https://supabase.com/docs/guides/realtime/authorization).
- **Host/player never receive session updates, or `channel.track()`
  presence silently does nothing.** Double-check the channel is opened with
  `config: { private: true }` (see `realtimeChannel.js` in both apps) —
  non-private channels skip Realtime Authorization RLS entirely, so
  broadcast-from-database messages never reach a non-private subscriber.
  Also confirm `supabase.realtime.setAuth(session.access_token)` runs after
  `signInAnonymously()` (in `supabaseClient.js`) so the socket has a JWT to
  check policies against.

## What's a sketch vs. production-ready

- `supabase/seed.sql` only has a handful of questions per CASAS level —
  add a real bank before running this with a class.
- Both apps poll `try_advance_if_expired` once a second while a question is
  live, as a resilience net (see architecture doc §9) — fine for 30 players,
  but consider throttling this further at larger scale.
- `realtime.broadcast_changes()` (used in the migration's triggers) is a
  newer Supabase feature — double-check its exact signature against your
  project's current Realtime docs. If it's unavailable on your plan, swap
  the triggers in `0001_init.sql` §6 for plain `postgres_changes`
  subscriptions on the client side instead (simpler, slightly less scalable
  at very high fan-out, but stable and long-documented).
- Minimal styling, no automated tests, no build-time question validation yet.
- `myAnsweredIndex` tracking in `player-client/src/main.js` is in-memory only
  — if a player refreshes mid-question after answering, this sketch will
  briefly show the choice buttons again (harmless, since the RPC still
  rejects the duplicate submit) rather than instantly restoring their
  "already answered" state. Persisting that client-side would close the gap.
