# Backlog: Turn The Reading Room into a PWA

**Status:** Not started — backlogged.
**Scoped:** 2026-06-24.
**Goal:** Make the existing web app installable to a phone home screen and fast on
cold boot, without a rewrite and without introducing a build step. Keep it vanilla
static files on the current GitHub Pages deploy.

## Why this path

The backend (Supabase: Postgres + Auth + Realtime + Storage) is already mobile-ready
and unchanged by any of this. Going mobile is a frontend + distribution question.

Of the options considered (PWA / Capacitor wrapper / native rewrite), **PWA is the
recommended starting point**: ~90% of the "it's an app on my phone" value for a
fraction of the cost, and nothing done for the PWA is wasted if we later wrap it in
Capacitor for App Store presence.

We are *further along than a typical web app*:
- `index.html` already ships a **mobile bottom tab bar** (`[data-tabbar]`) with
  responsive CSS that shows it only on narrow screens.
- Google OAuth uses a **same-origin browser redirect**
  (`auth.js`: `redirectTo = window.location.origin + window.location.pathname`),
  which a PWA keeps as-is. The native-OAuth rework that would bite us in a Capacitor
  wrapper is a **non-issue for the PWA path**.

## Scope of work

### 1. Web app manifest (new file: `manifest.webmanifest`)
- `name`, `short_name`, `description`, `theme_color` / `background_color` (use the
  parchment `--bg` token), `display: standalone`, icon list.
- **CRITICAL — subpath scope.** Prod is served from `https://jmalcolmo.github.io/bookclub/`
  (a subpath, not a root domain), while dev is at root (`localhost:5174`). So
  `start_url` and `scope` must resolve to `/bookclub/` in prod (use relative paths,
  or branch by host the way `config.js` already does). This is the #1 thing that
  silently breaks GitHub Pages PWAs. The service worker scope has the same constraint.

### 2. Icons (new assets — we currently have NONE; only node_modules favicons)
- Maskable 512×512 + 192×192 PNG, Apple touch icon 180×180, ideally an SVG source.
- Source art: the `📚` brand mark + parchment theme ("Deranged Granny Square").
- iOS ignores most of the manifest, so also add `apple-touch-icon` + iOS splash /
  status-bar `<meta>` tags in `index.html`.

### 3. Service worker (new file: `sw.js`) + registration in `src/main.js`
- Cache the app shell: `index.html`, `styles.css`, `club.css`, `src/*.js`.
- **CRITICAL — do not reintroduce the stale-module hang.** `devserver.py` deliberately
  sends `Cache-Control: no-store` because a stale ES module can hang the app on the
  loading splash (after an edit that adds an export, a fresh module imports a name from
  a cached stale one). A naive "cache everything forever" SW would reproduce that bug
  *in production* and worse — users stuck on an old module set after a deploy.
  - Use **network-first** (or stale-while-revalidate with a version bump per deploy)
    for the JS modules.
  - **Never cache Supabase API / Realtime calls** — pass straight to network.
  - Register the SW **only in prod** (or scope-guard it) so it doesn't interfere with
    the `no-store` dev workflow.

### 4. `index.html` `<head>` additions
- `<link rel="manifest">`, `theme-color` meta, `apple-touch-icon`, iOS splash /
  status-bar metas. (Viewport meta is already correct.)

### 5. Mobile-responsive audit (partly done)
- Tab bar exists, but there is a known `mobile-horizontal-scroll` issue and the Chrome
  preview tools **cannot reproduce it** (`overflow:clip` masks it) — fix at the source
  on real phone widths. Fuzziest line item: an afternoon to a few days depending on
  how many layouts misbehave. (See the `mobile-horizontal-scroll` memory.)

### 6. Deploy plumbing
- Service workers require HTTPS (GitHub Pages ✓). Confirm `sw.js` + manifest are served
  from the correct `/bookclub/` path and not blocked by Pages config.

## Effort estimate
- Manifest + icons + careful service worker: **1–2 focused days.**
- Responsive audit: variable (afternoon → few days).
- **No build step introduced; stays vanilla static files on the existing deploy.**

## Distribution / app stores
- **Pure PWA is distributed via the browser**, not a store: "Add to Home Screen" (iOS
  Safari) / install prompt (Android Chrome). No store, no review, no dev account, no fee.
  Discoverability is on us.
- **Google Play: yes, indirectly** via a Trusted Web Activity wrapper (Bubblewrap /
  PWABuilder). One-time $25 Play account.
- **Apple App Store: effectively no.** Apple rejects pure PWA wrappers (guideline 4.2).
  Getting into the Apple store requires the **Capacitor** path ($99/yr + native-OAuth
  rework). If "must be in the Apple App Store" is ever a hard requirement, jump to
  Capacitor instead — but the PWA work above is still reusable.

## Prerequisite for ALL mobile paths
The mobile-responsive pass (item 5) is a prerequisite regardless of PWA vs Capacitor
vs native, so it's the safest thing to do first.
