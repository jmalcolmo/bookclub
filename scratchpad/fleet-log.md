# Workstream: profile-shelf personal involvement view

Branch: `feature/profile-shelf-involvement` (off `develop`)

## What changed

Tapping a book on a profile "Books I've read" shelf — YOUR OWN shelf or a shelf
on ANOTHER reader's profile — opens a PERSONAL involvement view (keyed by
bookId + ownerId) showing only that reader's own reactions, replies, and
reading-progress for the book — not the whole club feed. A "Show complete
reactions" button opens the full club book history, but only when the viewer
and owner share a club that also has that work.

### Web
- `src/api.js`:
  - `userBookInvolvement(bookId, userId)` — owner's reactions (page-ordered),
    owner's replies on this book (each with its parent reaction), and owner's
    single reading_progress row. All via RLS; no client-side gating.
  - `sharedClubsForWork(openLibraryId, ownerId)` — clubs the viewer + owner
    co-share that also contain the work (matched by open_library_id). Returns
    [] on empty open_library_id (button stays hidden).
  - `readingHistoryFor(userId)` — generalization of `myReadingHistory()` (which
    now delegates to it): one reader's finished books, newest first, with their
    rating where the viewer may see the review. RLS gates everything: their
    progress rows only in shared clubs (or follow path), books only in visible
    clubs, their review only once the VIEWER finished (hidden ⇒ "not rated").
- `src/views/bookInvolvement.js` — new view.
- `src/main.js` — route `/reader/:ownerId/book/:bookId`.
- `src/views/profile.js`:
  - my shelf tap → `/reader/<me>/book/<id>`;
  - `renderOtherProfile()` now renders "THEIR SHELF — BOOKS THEY'VE READ"
    (readingHistoryFor, shared shelfRowHTML + paintCollapsible); taps →
    `/reader/<theirId>/book/<id>`. Section hides when RLS returns no rows.
    (Local var named `shelfBooks` to avoid shadowing `window.history`.)
- `club.css` — `.involvement-*`, `.book-cover.md` styles (Deranged Granny
  Square). The other-reader shelf reuses the existing shelf classes; no new CSS.
- `src/views/book.js` — NOT changed (full club history already lives here; the
  CTA routes to the existing `/club/:id/book/:bookId`).

### iOS
- `Services/API+Reactions.swift` — `userBookInvolvement(bookId:userId:)` +
  result structs `BookInvolvement` / `InvolvementReply`.
- `Services/API+Progress.swift` — `sharedClubsForWork(openLibraryId:ownerId:)`
  + `SharedClubBook`; `readingHistoryFor(_:)` (myReadingHistory delegates).
- `Views/BookInvolvementView.swift` — new view.
- `App/RootView.swift` — `Route.bookInvolvement(ownerId:bookId:)` + destination.
- `Views/ProfileView.swift` — my shelf tap routes to `.bookInvolvement`; the
  other-reader body now shows "Their Shelf - Books They've Read" (collapsible,
  reuses shelfRow) whose taps route to `.bookInvolvement(ownerId: readerId, …)`.
  Shelf hidden when RLS returns no rows.
- `Views/BookView.swift` — NOT changed (reused as the "complete reactions" target).

### Tests (`tests/run.mjs`)
Added five steps after the reading-history step:
- INVOLVEMENT (self): A sees own reactions (both pages) + own finished progress.
- CROSS-READER SHELF: co-member B resolves A's finished shelf via the
  readingHistoryFor query shape (progress rows + book resolution under RLS).
- INVOLVEMENT SPOILER GATE: from that shelf entry, B "opens A's involvement" —
  B at page 100 sees A's page-35 reaction but NOT the page-200 one (gate holds
  on the cross-reader path). Restores B's progress afterward.
- SHARED CLUBS: sets an open_library_id on the book, then confirms the co-shared
  club resolves for viewer B / owner A by the same intersection the api uses.
- SHARED CLUBS empty: empty open_library_id matches no book row (button hidden).

## Spoiler-gate note (RLS)
No schema change needed or made. Confirmed in `supabase/schema.sql`:
- `progress_select_member` (line ~542): `is_club_member(book_club(book_id)) OR
  (is_following(user_id) AND NOT is_club_member(...))` — a co-member CAN read the
  owner's reading_progress (powers the cross-reader shelf + progress line). ✅
- `reactions_select_spoiler_gated` (line ~595): a co-member sees the owner's
  reaction only if they wrote it OR have `has_read_to(book_id, page)`. The
  involvement view relies entirely on this; it never re-implements gating. ✅
- reaction_replies inherit their parent reaction's visibility, so the owner's
  replies come back only when their parent is readable to the viewer. ✅
- reviews: the owner's rating on a shelf row only resolves when the viewer has
  finished that book (review gate); hidden ⇒ "not rated". ✅

## MANUAL TEST STEPS

### Web (dev Supabase, http://localhost:5174)
Setup (dev data): two users who share a club, both with progress on a book the
club finished reading; the shelf owner must have `status='finished'` progress.
For the "Show complete reactions" button, the club's `books` row needs a
non-empty `open_library_id` (books added via the Open Library lookup carry one).

MY OWN SHELF
1. `python devserver.py 5174`, open http://localhost:5174, sign in (Google).
2. Profile tab → "MY SHELF — BOOKS I'VE READ".
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

ANOTHER READER'S SHELF (cross-reader path)
7. Open a club-mate's profile (tap their name/avatar anywhere → `#/user/<id>`).
   - EXPECT: below their card, "THEIR SHELF — BOOKS THEY'VE READ" listing the
     finished books you're allowed to see (books in clubs you share). Their
     rating shows only if YOU have finished that book; otherwise "not rated".
8. Tap a shelf book.
   - EXPECT: route `#/reader/<theirId>/book/<bookId>`, title
     "<THEIR NAME>'S READING", THEIR progress line, "their reactions" showing
     ONLY the reactions you've unlocked (page ≤ your logged page — the spoiler
     gate still applies), "their replies" likewise.
9. "Show complete reactions" is present (you share the club) when the book has
   an open_library_id → opens the same full club history.
10. On a profile of a reader you DON'T share a club with (e.g. follow-only):
    the shelf section is absent or shows only follow-visible solo books —
    nothing from clubs you're not in.

### iOS (scheme: ReadingRoom, target: ReadingRoom)
Build the `ReadingRoom` scheme onto a simulator/device and sign in.
1. Profile tab → "My Shelf - Books I've Read" → tap a finished book.
   - EXPECT: pushes "My Reading" with the book header + your progress line,
     "your reactions" (only yours), "your replies" (only yours).
2. Shared-club + open_library_id present → "Show complete reactions" button
   pushes BookView (full club feed). Multiple shared clubs → "pick a club"
   list of NavigationLinks, each opening that club's BookView.
3. No open_library_id → no button.
4. Cross-reader: tap a club-mate's name/avatar (ReaderLink) → their profile
   shows "Their Shelf - Books They've Read" under the follow card. Tap a book →
   pushes "Reading" with THEIR progress/reactions/replies, spoiler-gated to
   what YOU have unlocked. "Show complete reactions" behaves as in step 2.
5. A reader you share no club with → no shelf section (RLS returns nothing),
   or only follow-visible solo books if you follow them.

### Automated action test
`npm test` (needs `.passwords/test-users.json`) exercises the new api paths:
look for the INVOLVEMENT, CROSS-READER SHELF and SHARED CLUBS steps to pass.

## Human check list
- Confirm the "Show complete reactions" button appears/hides correctly against
  real dev data (depends on open_library_id + co-membership).
- Cross-reader shelf: verify a club-mate's profile shows the shelf and the
  involvement view gates their reactions to what you've unlocked (also covered
  by the INVOLVEMENT SPOILER GATE test step).
- Follow-only readers: their shelf may list solo-club books via the additive
  follow RLS path; confirm nothing from unshared clubs leaks (RLS-enforced).
