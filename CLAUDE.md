# CLAUDE.md — The Reading Room

Shared context for any AI agent working in this repo. Read this first. Keep it
up to date when conventions change.

## What this is

**The Reading Room** — a multi-user book club web app. Members sign in, join/create
clubs, track reading progress, post **spoiler-gated reactions**, review finished
books, and decide who picks next (spin-the-wheel / vote / direct pick). It was
pivoted from a marble-racing game; the original race is **parked** at `race.html`
(+ `app.js`) and untouched — do not work on it unless explicitly asked.

## Stack & hosting

- **Frontend:** vanilla HTML/CSS/JS, **ES modules, no build step**. Served as static files.
- **Backend:** Supabase — Postgres + Google OAuth + Realtime + Storage.
- **Hosting:** GitHub Pages (prod), localhost (dev). Repo: https://github.com/jmalcolmo/bookclub

## Environments

| | Dev | Prod |
|---|---|---|
| App | http://localhost:5174 | https://jmalcolmo.github.io/bookclub/ |
| Supabase ref | `wwzvwjhohkyudytoqvfl` | `kxiyvqpmmfbibeoygmnw` |
| Chosen when | hostname `localhost`/`127.0.0.1` | any other hostname |

`config.js` picks the project by hostname. It holds only **publishable** keys
(public-safe under RLS). Secrets live in `.passwords/` (git-ignored) — never commit them.

## Branching / workflow

- `main` = prod (Pages deploys it; **protected**, changes land via PR).
- `develop` = integration branch.
- `feature/*` → PR into `develop` → PR `develop` into `main` to release.
- Develop locally on a feature branch against the **dev** Supabase project, then PR.
- Every push to `main` auto-rebuilds prod (~1–2 min).

## Architecture & conventions

```
index.html         book club shell (loads src/main.js)
race.html          parked marble race (do not touch)
config.js          dev/prod creds by hostname
styles.css         original granny-square theme (shared base)
club.css           book club styles
src/
  main.js          boot + nav + routes
  router.js        hash router (+ onCleanup registry for subscriptions)
  store.js         signed-in user/profile
  supabaseClient.js
  auth.js          Google OAuth
  api.js           ALL Supabase data access
  openlibrary.js   book lookup
  ui.js            DOM/format helpers
  views/           login, clubs, club, book, picker, history, profile
supabase/schema.sql   run in each Supabase project
```

**Rules (do not break these):**

1. **All DB access goes through `src/api.js`.** Views never call `supabase.from(...)`
   directly. Add a function to `api.js` and call it from the view.
2. **Spoiler-gating is a server-side invariant.** Reactions are page-tagged; the
   RLS `SELECT` policy only returns a reaction if the reader wrote it OR their saved
   `reading_progress.current_page >= reaction.page`. Never weaken this, and never
   re-implement gating only in the client — the client must rely on RLS. Reviews
   unlock only when the reader's progress status is `finished`.
3. **Escape user input** with `esc()` from `ui.js` before putting it in `innerHTML`.
4. **Realtime subscriptions** must register their unsubscribe via `onCleanup()` from
   `router.js` (the router tears them down before every render). Do not tie cleanup
   to `hashchange` — it won't fire on same-route re-renders.
5. **Schema changes** must be applied to BOTH Supabase projects (dev then prod) and
   reflected in `supabase/schema.sql`. The script is idempotent (`create or replace`,
   `if exists`, `if not exists`); keep it that way. `set check_function_bodies = off`
   is required near the top because helper functions reference later-defined tables.
6. **New screen pattern:** add api fn(s) in `api.js` → view in `src/views/` → register
   route in `main.js` → wire nav if needed → styles in `club.css`.

## Design system — "Deranged Granny Square"

Warm parchment + crochet feel. Reuse, don't reinvent.

- Tokens in `styles.css` `:root`: `--bg`, `--surface`, `--surface-2`, `--text-primary`,
  `--text-muted`; yarn accents `--yarn-ochre/sage/rust/slate/mauve/bark/moss/clay`;
  `--positive/negative/warning`; `--shadow-soft/lift/deep`.
- Fonts: **Crimson Pro** (display) + **DM Mono** (labels/numbers). No Inter/Roboto/system.
- Cards = `.patch` (thick yarn-colored borders, offset warm shadows, slight rotation).
- Buttons: `.btn-primary`, `.btn-ghost`, `.btn-back`, `.btn-icon`. Headers: `.stamp-title`.
- New book-club components live in `club.css`; keep them on-theme.

## Verifying changes

- Serve locally: `python devserver.py 5174` → http://localhost:5174 (uses dev project).
  Use this, **not** `python -m http.server`: it sends `Cache-Control: no-store` so the
  browser always pulls fresh ES modules. Plain `http.server` lets the browser heuristically
  cache modules, which after an edit that adds an export can leave a fresh module importing a
  name from a stale one — the import fails and the app hangs on the loading splash. If that
  happens, hard-refresh (Ctrl+Shift+R) or use an Incognito window once.
- Google sign-in needs a real browser session (can't be automated headless).
- Boot/console checks and layout screenshots can be automated via the preview tools.

## Gotchas

- ES modules need http(s), not `file://`.
- After OAuth, Supabase leaves a `#access_token=...` fragment; `main.js` routes any
  non-`#/` hash to `/clubs`.
- Join codes are private — non-members find a club via the `find_club_by_code` RPC,
  never by listing `clubs`.
