# Backlog: Native Swift iOS app (the main product)

**Status:** DECIDED (2026-07-01) - this is the committed mobile direction. Not started;
long-horizon, built incrementally.
**Scoped:** 2026-07-01.
**Goal:** Ship The Reading Room as a native Swift (SwiftUI) iOS app published to the
Apple App Store, as the **primary product** for readers.

## Product decision (2026-07-01)

- **Native Swift iOS is the main product.** Readers are expected to use this on their
  phone in the real world, so the native app is where the best experience lives.
- **The web app stays alive as a supported SECONDARY client** for people who don't want
  the app. It keeps its current vanilla stack and workflow. Web-only polish (responsive
  audit, installability niceties) lives in `docs/pwa-conversion.md`, which is now
  **superseded as a mobile/store strategy** - it is NOT a path to the App Store anymore.
- **The Capacitor / web-wrapper route is dropped.** We are not shipping a wrapped web
  app. Rationale: for an app like this a wrapper loses feel and native integration, not
  core features, and making iOS the primary product means we want native feel + deep
  integration (widgets, Live Activities, share extension, gestures), and we accept
  maintaining two front ends (native iOS primary, web secondary).

**Reality check:** large, multi-phase effort with hard costs (Apple Developer Program
$99/yr, a Mac, real engineering time to rebuild 9 screens in SwiftUI). It will NOT be
done in one push - chip at it incrementally using the phased checklist below.

## What's already in our favor

The **Supabase backend is mobile-ready and unchanged** by any of this (Postgres + RLS +
Auth + Realtime + Storage). Spoiler-gating and all authz are server-side (RLS), so a
native client just calls the same tables/RPCs - no re-implementing rules client-side.
`index.html` already ships a mobile bottom tab bar. Publishable anon keys are safe to
embed. The mobile-responsive pass (`mobile-horizontal-scroll` issue) is a prerequisite
for EVERY mobile route, so it's the safest first thing to do regardless of A vs B.

## Key decisions still to lock

(Native-vs-wrapper is already settled - native. These remain open.)

- SwiftUI vs. UIKit (recommend SwiftUI; UIKit/SpriteKit maybe for the spin wheel).
- Minimum iOS target (recommend 16/17).
- How faithfully to rebuild the "Deranged Granny Square" theme natively.
- App identity: name, bundle ID, category, iPhone-only vs. Universal.
- Push notifications: net-new (feed is currently derived client-side, no notif table),
  or skip.

## Checklist (full native Swift), phased

### Phase 1 - Apple prerequisites and accounts
- [ ] Apple ID with 2FA.
- [ ] Enroll in Apple Developer Program ($99/yr; Individual is fastest).
- [ ] App Store Connect access + accept agreements / tax-banking forms.
- [ ] Register the app's bundle identifier.

### Phase 2 - Mac and toolchain
- [ ] Secure a Mac (buy/borrow/cloud - Windows cannot build iOS). Apple Silicon preferred.
- [ ] Install Xcode + `xcode-select --install`; sign in with the developer account.
- [ ] Verify a Hello-World SwiftUI build runs on Simulator + a physical iPhone.
- [ ] (Optional) install fastlane for signing/screenshots/upload automation.

### Phase 3 - Project scaffolding + config
- [ ] Create the SwiftUI Xcode project; set bundle ID + team.
- [ ] Decide monorepo `/ios` folder vs. separate repo; add Swift `.gitignore`.
- [ ] Dev/prod build configs (.xcconfig) carrying each Supabase URL + publishable anon
      key (dev `wwzvwjhohkyudytoqvfl`, prod `kxiyvqpmmfbibeoygmnw`). Never embed
      service_role.
- [ ] Add SPM deps: `supabase-swift`, GoogleSignIn-iOS (if native auth), image cropper.
- [ ] Info.plist: display name, launch screen, photo-library usage string, OAuth URL scheme.
- [ ] Bundle + register Crimson Pro + DM Mono fonts.

### Phase 4 - Supabase data layer in Swift
- [ ] Singleton Supabase client (persist session, auto-refresh) mirroring supabaseClient.js.
- [ ] Port `src/api.js` as a Swift service layer (views never call Supabase directly).
      Cover: profiles, clubs/members (incl. myClubs de-dupe + counts), books, progress
      (+ myReadingHistory), reactions (RLS-gated), reviews, selections/votes, replies,
      engagements, announcements.
- [ ] Codable model structs for every table; snake_case decoding.
- [ ] `find_club_by_code` RPC via `.rpc(...)`.
- [ ] Open Library search via URLSession (keep 12s timeout + field list).
- [ ] Storage: `avatars` + `club-images` upload/getPublicUrl, same path conventions.
- [ ] Realtime channels (picker/book/feed/progress) with cleanup on view disappear
      (native equivalent of the router's onCleanup).

### Phase 5 - Auth (Google OAuth, native)
- [ ] Choose native GoogleSignIn (`signInWithIdToken`) vs. ASWebAuthenticationSession.
- [ ] Register custom URL scheme; add redirect to Supabase Auth (dev + prod).
- [ ] Configure Google Cloud iOS OAuth client + reversed client ID scheme.
- [ ] Handle callback, persist session (Keychain), port sign-out + auth-state store.
- [ ] Test full loop on a real device (Google sign-in can't be tested headless).

### Phase 6 - Port the 9 screens to SwiftUI
- [ ] Navigation: NavigationStack + TabView matching the hash router + bottom tabs.
- [ ] Shared theme layer (tokens, `.patch` card, stamp-title, buttons, fonts).
- [ ] login, feed (client-derived + engagements + announcements), clubs, club (roster +
      cover upload + admin), book (progress + page-tagged reactions + replies + realtime),
      picker (wheel/vote/pick + realtime; marker must match server result_user), history,
      progress (+ reaction-progress sync), profile (avatar upload + crop).
- [ ] Native image cropping (PhotosUI) replacing imageCropper.js.
- [ ] Toasts + loading/empty/error states per screen.

### Phase 7 - Native features
- [ ] App icon + launch screen asset catalog (1024px master).
- [ ] Decide push notifications (APNs + Edge Function) or skip.
- [ ] Optional deep links / universal links.
- [ ] Offline states, dark mode, Dynamic Type, accessibility, safe-area layout.

### Phase 8 - Backend adjustments
- [ ] Add iOS redirect URLs to Supabase Auth (dev + prod).
- [ ] Any new schema (e.g. push tokens) applied to BOTH projects + schema.sql (idempotent).
- [ ] Verify RLS spoiler-gating holds for the native client; confirm storage policies.
- [ ] Revisit open rate-limit / abuse hardening before public store exposure.

### Phase 9 - Testing
- [ ] Unit-test the Swift service layer vs. dev project (mirror tests/run.mjs intent).
- [ ] XCUITest for critical flows; device matrix (SE -> Pro Max), light/dark, slow net.
- [ ] Verify realtime + subscription cleanup; Instruments for leaks.

### Phase 10 - App Store assets + metadata
- [ ] App Store Connect record; metadata; keywords; category.
- [ ] App Privacy nutrition label + hosted Privacy Policy URL.
- [ ] Age rating; screenshots (6.7"/6.9" min); 1024 icon.
- [ ] Pricing/availability; App Review notes + a reviewer/demo login (Google auth caveat).

### Phase 11 - Build, TestFlight, submission
- [ ] Distribution cert + App Store provisioning profile (auto-signing or fastlane match).
- [ ] Release scheme -> prod Supabase; set version + build number.
- [ ] Archive, validate, upload (Organizer / fastlane pilot).
- [ ] TestFlight internal (then external) testing; iterate on fixes.
- [ ] Attach final build, complete metadata, submit for review, handle rejections.
- [ ] Publish to the App Store.

## Related
- `docs/pwa-conversion.md` - SUPERSEDED as a mobile/store strategy. Retained only for
  web-secondary polish (the responsive audit keeps the web version lovely). Not a path
  to the App Store.
