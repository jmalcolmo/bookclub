# Workstream: profile-shelf personal involvement view

Branch: `feature/profile-shelf-involvement` (off `develop`)

## What changed

Tapping a book on a profile "Books I've read" shelf now opens a PERSONAL
involvement view (keyed by bookId + ownerId) showing only that reader's own
reactions, replies, and reading-progress for the book — not the whole club feed.
A "Show complete reactions" button opens the full club book history, but only
when the viewer and owner share a club that also has that work.

### Web
- `src/api.js`:
  - `userBookInvolvement(bookId, userId)` — owner's reactions (page-ordered),
    owner's replies on this book (each with its parent reaction), and owner's
    single reading_progress row. All via RLS; no client-side gating.
  - `sharedClubsForWork(openLibraryId, ownerId)` — clubs the viewer + owner
    co-share that also contain the work (matched by open_library_id). Returns
    [] on empty open_library_id (button stays hidden).
- `src/views/bookInvolvement.js` — new view.
- `src/main.js` — route `/reader/:ownerId/book/:bookId`.
- `src/views/profile.js` — shelf tap now navigates to `/reader/<me>/book/<id>`.
- `club.css` — `.involvement-*`, `.book-cover.md` styles (Deranged Granny Square).
- `src/views/book.js` — NOT changed (full club history already lives here; the
  CTA routes to the existing `/club/:id/book/:bookId`).

### iOS
- `Services/API+Reactions.swift` — `userBookInvolvement(bookId:userId:)`.
- `Services/API+Progress.swift` — `sharedClubsForWork(openLibraryId:ownerId:)`.
- `Models/JoinedModels.swift` — `BookInvolvement`, `InvolvementReply`, `SharedClubBook`.
- `Views/BookInvolvementView.swift` — new view.
- `App/RootView.swift` — `Route.bookInvolvement(ownerId:bookId:)` + destination.
- `Views/ProfileView.swift` — shelf tap now routes to `.bookInvolvement`.
- `Views/BookView.swift` — NOT changed (reused as the "complete reactions" target).

### Tests (`tests/run.mjs`)
Added four steps after the reading-history step:
- INVOLVEMENT (self): A sees own reactions (both pages) + own finished progress.
- INVOLVEMENT SPOILER GATE: B at page 100 sees A's page-35 reaction but NOT the
  page-200 one (confirms the gate still applies through this view). Restores B.
- SHARED CLUBS: sets an open_library_id on the book, then confirms the co-shared
  club resolves for viewer B / owner A by the same intersection the api uses.
- SHARED CLUBS empty: empty open_library_id matches no book row (button hidden).

## Spoiler-gate note (RLS)
No schema change needed. Confirmed in `supabase/schema.sql`:
- `progress_select_member` (line ~542): `is_club_member(book_club(book_id)) OR
  (is_following(user_id) AND NOT is_club_member(...))` — a co-member CAN read the
  owner's reading_progress. ✅
- `reactions_select_spoiler_gated` (line ~595): a co-member sees the owner's
  reaction only if they wrote it OR have `has_read_to(book_id, page)`. The
  involvement view relies entirely on this; it never re-implements gating. ✅
- reaction_replies inherit their parent reaction's visibility, so the owner's
  replies come back only when their parent is readable to the viewer. ✅

## MANUAL TEST STEPS

### Web (dev Supabase, http://localhost:5174)
Setup (dev data): sign in as a user with at least one FINISHED book on their
shelf. For the "Show complete reactions" button to appear, that book's club
`books` row must have a non-empty `open_library_id` AND you must share that
club with the book's owner (for your own shelf you are trivially a co-member).
Books added via the Open Library lookup already carry an open_library_id.

1. `python devserver.py 5174`, open http://localhost:5174, sign in (Google).
2. Go to Profile tab → "MY SHELF — BOOKS I'VE READ".
3. Tap a finished book.
   - EXPECT: route `#/reader/<yourId>/book/<bookId>`, title "MY READING",
     the book header with your progress line ("✓ Finished page X / Y …"),
     a "your reactions" section (only YOUR reactions), a "your replies"
     section (only YOUR replies). No one else's reactions appear.
4. If the book has an open_library_id and you're in the club: a
   "Show complete reactions" button shows.
   - Tap it → lands on the full club book history (`#/club/<id>/book/<id>`)
     showing everyone's spoiler-gated feed.
   - If the same work (same open_library_id) exists in MULTIPLE clubs you're in,
     you instead get a "pick a club" chooser first; tapping a club opens that
     club's full history.
5. If the book has NO open_library_id: the button is absent (expected).
6. Back button returns to the profile.

### iOS (scheme: ReadingRoom, target: ReadingRoom)
Build the `ReadingRoom` scheme onto a simulator/device and sign in.
1. Profile tab → "My Shelf - Books I've Read".
2. Tap a finished book.
   - EXPECT: pushes "My Reading" screen with the book header + your progress
     line, "your reactions" (only yours), "your replies" (only yours).
3. If shared-club + open_library_id present: "Show complete reactions" button
   → pushes BookView (full club feed). Multiple shared clubs → a "pick a club"
   list of NavigationLinks, each opening that club's BookView.
4. No open_library_id → no button.

### Automated action test
`npm test` (needs `.passwords/test-users.json`) exercises the new api paths:
look for the INVOLVEMENT and SHARED CLUBS steps to pass.

## Human check list
- Confirm the "Show complete reactions" button appears/hides correctly against
  real dev data (depends on open_library_id + co-membership).
- Confirm the spoiler gate holds in the involvement view for a co-member viewing
  ANOTHER reader's shelf (the view is generic on ownerId; current shelf taps are
  self-only, so cross-reader entry would require a future caller — the RLS path
  is already correct and tested).
