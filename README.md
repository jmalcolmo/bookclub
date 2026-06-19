# The Reading Room — Book Club Edition

A social space for book clubs, built on the "Deranged Granny Square" theme from the
original Marble Race. Members sign in, join or create clubs, track who's reading
what, drop **spoiler-gated reactions** (only visible to people who've read that far),
review finished books, and decide who picks next via a spinning wheel, a vote, or a
direct pick. The original marble race is parked at `race.html` and will return as a
fourth picker method.

- **Frontend:** vanilla HTML/CSS/JS, ES modules, no build step.
- **Backend:** [Supabase](https://supabase.com) — Postgres + Auth (Google) + Realtime + Storage.
- **Spoiler-gating** is enforced *server-side* via Row-Level Security, not just in the UI.
- **Hosting:** static (GitHub Pages) for prod; localhost for dev. Two Supabase projects.

---

## Architecture

```
index.html        book club shell (loads src/main.js)
race.html         the original marble race (parked, untouched)
config.js         dev/prod Supabase creds, chosen by hostname
styles.css        original granny-square theme (shared)
club.css          book club styles
app.js            marble race engine (used by race.html only)
supabase/schema.sql   run this in each Supabase project
src/
  main.js         boot + nav + routes
  router.js       hash router
  store.js        signed-in user/profile
  supabaseClient.js
  auth.js         Google OAuth
  api.js          all DB access (the only file that touches Supabase data)
  openlibrary.js  book lookup
  ui.js           DOM/format helpers
  views/          login, clubs, club, book, picker, history, profile
```

The environment is chosen automatically by hostname:
`localhost` / `127.0.0.1` → **dev** project, anything else → **prod** project.

---

## One-time backend setup (do this for BOTH the dev and prod projects)

1. **Run the schema.** In the Supabase dashboard → SQL Editor, paste and run
   [`supabase/schema.sql`](supabase/schema.sql). It creates all tables, the
   spoiler-gating RLS policies, storage buckets, and the auto-profile trigger.

2. **Enable Google auth.** Dashboard → Authentication → Providers → Google →
   enable, and paste a Google OAuth client ID + secret
   (Google Cloud Console → Credentials → OAuth client → Web application).
   - Authorized redirect URI for Google: `https://<your-project-ref>.supabase.co/auth/v1/callback`
   - In Supabase → Authentication → URL Configuration, add your **Site URL** and
     **Redirect URLs**:
     - dev project: `http://localhost:5173` (or whatever port you use)
     - prod project: `https://<your-username>.github.io/<repo>/`

3. **Copy the keys into `config.js`.** From Dashboard → Project Settings → API,
   copy the **Project URL** and the **anon public** key into the matching block
   in `config.js`. (The anon key is safe to commit — RLS guards everything. Never
   put the `service_role` key in the repo.)

---

## Run locally (dev)

ES modules need to be served over http (not opened as a `file://`). Any static
server works:

```bash
# Python
python -m http.server 5173
# or Node
npx serve -l 5173
```

Then open <http://localhost:5173>. It will use the **dev** Supabase project.

---

## Deploy to production (GitHub Pages)

```bash
git add -A
git commit -m "..."
git push
```

Then in the repo on GitHub: **Settings → Pages → Build and deployment → Source:
Deploy from a branch**, pick your branch and `/ (root)`. The site publishes at
`https://<username>.github.io/<repo>/`, which uses the **prod** Supabase project.

`.nojekyll` is included so GitHub Pages serves the `src/` modules as-is.

> Make sure the prod URL is listed in the **prod** Supabase project's Redirect URLs
> (step 2 above), or Google sign-in will bounce back with an error.

---

## How the spoiler gate works

A reaction is tagged with the page it's about. The RLS `SELECT` policy on
`reactions` only returns a row to you if you wrote it **or** your own saved
`reading_progress.current_page` for that book is `>=` the reaction's page. The
client literally never receives reactions past where you've read — so there's
nothing to leak in the network tab. Log your progress honestly and reactions
unlock as you go. Reviews are full spoilers and unlock only once you've marked the
book finished.
