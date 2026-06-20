---
name: new-screen
description: Scaffold a new screen/feature in The Reading Room following its established module pattern. Use when adding a new view, page, screen, route, or feature to the book club app (e.g. a notifications page, a club settings screen, a stats view). Keeps data access in api.js, routing in main.js, and styling on-theme.
---

# New screen / feature

This app has one fixed pattern for adding UI. Follow all five steps so the codebase
stays consistent. (No build step — everything is vanilla ES modules.)

## The pattern

1. **Data access → `src/api.js`.** Add a function for every DB read/write the feature
   needs. Views must NEVER call `supabase.from(...)` directly. Use the `unwrap()` helper
   and follow the existing style (e.g. `clubBooks`, `bookReactions`). If it reads gated
   data, remember RLS already filters it — render whatever comes back.

2. **View → `src/views/<name>.js`.** Export a `renderX({ params })` function that builds
   HTML and calls `render(html, after)` from `router.js`. Conventions:
   - Escape all user content with `esc()` from `ui.js`.
   - Use `avatarHTML`, `timeAgo`, `fmtDate`, `daysUntil`, `toast` from `ui.js`.
   - Wire event listeners in the `after(root)` callback (no inline `onclick`).
   - For realtime, subscribe via `api.subscribe(...)` and register the returned
     unsubscribe with `onCleanup()` from `router.js` (NOT a hashchange listener).

3. **Route → `src/main.js`.** Import the view and register it:
   `route("/your/path/:id", renderX);` Paths are hash-based. Nested club routes look
   like `/club/:id/<thing>`.

4. **Navigation.** Add the entry point: a button/link in the relevant view (e.g. a
   toolbar button in `club.js`) that calls `navigate("/your/path")`, or a top-nav link
   in `index.html` wired in `main.js`'s `wireNav()`.

5. **Styles → `club.css`.** Add classes there (not `styles.css`, which is the shared
   theme base). Reuse `.patch`, `.screen-pad`, `.screen-header`, buttons, and the
   design tokens. Match the granny-square look (see the `style` skill).

## Checklist before shipping

- [ ] All DB access is in `api.js`.
- [ ] User input escaped with `esc()`.
- [ ] Realtime (if any) cleaned up via `onCleanup()`.
- [ ] Route registered and reachable from nav.
- [ ] `node --check` passes on every changed `.js` file.
- [ ] Styled on-theme in `club.css`.
- [ ] If the feature adds a new user action, **add it to the `test` skill**.
- [ ] If it needs schema changes, use the `supabase-change` skill first.
- [ ] Verified on localhost:5174 (dev), then `ship`.
