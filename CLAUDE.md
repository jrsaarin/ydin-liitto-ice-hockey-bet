# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A bookkeeping app for a hockey bet between seven friends. Players snake-draft four NHL teams each, then a "cup" travels between teams through the regular season: whoever beats the holder takes it. The rules are listed in README.md and are the source of truth for `worker/cup.js`.

## Commands

```sh
npm run dev                # Vue app + Worker + local D1 on http://localhost:5173
npm test                   # all unit tests (node:test, no extra runner)
node --test test/cup.test.js                                  # one file
node --test --test-name-pattern="snake order" test/draft.test.js   # one test
npm run build              # vite build: dist/client (assets) and dist/ydin_liitto_cup (Worker)
npm run db:migrate:local   # apply migrations/ to the local D1 in .wrangler/
npm run db:migrate:remote  # apply migrations/ to production
npm run deploy             # build, then wrangler deploy
npx wrangler deploy --dry-run   # check the bundle and bindings without publishing
```

The local passwords are `dev` for a member and `commish` for the commissioner (from `.dev.vars`, copied from `.dev.vars.example`). Every API call needs one of them:

```sh
curl -H "x-league-passcode: dev" http://localhost:5173/api/state
curl "http://localhost:5173/cdn-cgi/handler/scheduled"   # run the cron job once
```

A fresh checkout needs `npm run db:migrate:local` before the API works.

There is no linter or type checker. The code is plain JavaScript (ES modules) and Vue single-file components.

## Architecture

One Cloudflare Worker serves everything. Static assets are the built Vue app. Only `/api/*` reaches Worker code (`run_worker_first` in `wrangler.jsonc`). `@cloudflare/vite-plugin` runs both in one dev server, so there is no proxy and no separate `wrangler dev`.

### Why there is a backend

- The NHL API (`api-web.nhle.com`) sends no CORS headers, so browsers cannot call it.
- The draft has to be shared between seven devices.

### Worker (`worker/`)

- `config.js` holds everything season-specific: season id, first and last day, starting holder, player names. A new season is an edit here.
- `cup.js` and `draft.js` are pure functions with no I/O. All rule logic lives in them and all rule tests target them. Keep them pure.
- `nhl.js` fetches and flattens one schedule week. `sync.js` decides which weeks to fetch and writes only changed rows.
- `db.js` is the only file with SQL. It maps snake_case rows to camelCase objects.
- `avatar.js` validates profile pictures. `src/image.js` imports its size constant, which is the one place where the frontend reads Worker code.
- `index.js` is the router. Every mutation answers with the full state, the same payload as `GET /api/state`, so the client never merges partial updates.

### Data flow

1. A cron trigger runs `syncGames` once a day at 11:00 UTC, when all games of the North American evening are final. It refetches the week around today and six more weeks from a rolling cursor (`backfill_cursor` in the `meta` table) that wraps around the season, so rescheduled games are picked up within five days.
2. After a sync, if the draft is complete, the cup result is computed from all games and stored as JSON in `meta.cup_cache`.
3. `GET /api/state` reads players, picks and `meta`. It never reads the `games` table unless the cache is missing.
4. Any change to the draft deletes `cup_cache`.

Profile pictures follow their own path, because they are large and the state is polled every few seconds. The state carries only `avatarsVersion`. When it changes, the client fetches all pictures once from `GET /api/avatars`. Pictures are keyed by player name, not id, so they survive a reset. They are data URLs in D1, since R2 would need a payment method on the account.

`GET /api/state` also starts a background sync when the last one is older than 26 hours. That is a safety net for a missed cron run and the reason local development works without it. The commissioner can force a sync from the fix panel.

### Frontend (`src/`)

- `store.js` is the single reactive store. `act()` posts a change and replaces the whole state. `refresh()` polls, every 4 seconds during the draft and every 10 minutes afterwards.
- `App.vue` switches between two phases on `league.status`: the interactive `DraftView`, then the read-only `StandingsView` plus `TeamsView`. There is no router.
- The password and the chosen player name live in `localStorage`. The name is matched against player names, not ids, because ids change on reset.
- An owner of `null` means an undrafted team. It appears in `nextGame.challengerOwner` and in history entries, and in `cup.holderOwner` only if the starting holder was not drafted.

## Constraints that shaped the code

- **Free plan CPU limit.** A Worker invocation gets about 10 ms of CPU and 50 outgoing requests. A schedule week is roughly 90 kB of JSON and parses in well under a millisecond, so seven weeks per run is comfortable. Fetching the whole season in one run would be close to both limits. The cup result is cached rather than computed per request for the same reason.
- **Free plan quotas are the cost ceiling.** Nothing here may require the paid plan. Check new features against the Workers and D1 free limits.
- **Checks before database.** `requireFairUse` (rate limit per address) and `requirePasscode` run before any D1 query, so unauthenticated traffic costs no database reads. Keep that order.
- **Roles come from the password.** `requirePasscode` returns `member` or `commish`. There are no accounts or sessions. The role is sent to the client as `viewer.role`, but the server is what enforces it: undo, reset, and picks for the commissioner's player answer 403 to a member.
- **Results are a day old by design.** The group asked for one sync per day. Live scores are out of scope, so `nextGame.live` is only ever true after a manual sync during a game.
- **Migrations go first.** Production has live data. Apply a new migration before deploying the code that needs it. The avatar queries tolerate a missing table for that reason, and new tables should get the same treatment.
- **Draft races.** `picks.pick_number` is the primary key and `picks.team` is unique. Two simultaneous picks cannot both succeed. The client also sends the pick number and player it believes are on the clock, and the server rejects a mismatch.
- **Rules live in one place.** Each history entry carries `pointTo` and `changedHands`. Use those rather than re-deriving the rules in the UI.
- **Cup chain.** `computeCup` walks the holder's games in time order and stops at the first unfinished one, so a late result can never be applied out of order. An unfinished game older than 36 hours is skipped so that a silently postponed game cannot freeze the cup.

## Decisions made with the group

- The point for a cup game goes to the owner of the winner. Losing never scores, so the game that ends a reign pays the new holder. Scoring "games played as holder" was considered and rejected.
- An undrafted team cannot take the cup. If it beats the holder, the cup stays and nobody scores. Letting the cup travel to undrafted teams was considered and rejected.
- Regular season only. Playoffs are not part of the bet.
- Rank is decided by points alone. Captures and defenses are shown but break no ties.
- Identity inside the group is on trust. Do not add per-player authentication. The one exception is the commissioner, named in `CONFIG.commissioner`, who has a separate password.
- Anyone in the group may draw the draft order. Only the commissioner can undo picks or reset.
- After the draft the page is read-only for members. The commissioner keeps the fix panel.
- Profile pictures can only be set during the draft phase, by the player themselves, on trust.
