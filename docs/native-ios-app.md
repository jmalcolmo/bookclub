# Backlog: Native Swift iOS app (the main product)

**Status:** CODE COMPLETE (2026-07-02) - the full native app lives in `/ios`: data +
auth layer (Phases 4-5), all 9 SwiftUI screens (Phase 6), native features (Phase 7),
backend verification (Phase 8), tests (Phase 9), and store metadata drafts + release
config (Phases 10-11 up to the account boundary). Remaining work is user-gated:
Google iOS OAuth client, on-device auth test, screenshot capture, and everything in
Phase 11 needing the Apple Developer account. See the Decisions log at the bottom.
**Scoped:** 2026-07-01. **Built:** 2026-07-02.
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
- [x] Create the SwiftUI Xcode project; set bundle ID + team. - Project is defined as an
      XcodeGen manifest (`ios/project.yml`, bundle id `com.jmalcolmo.thereadingroom`);
      run `cd ios && xcodegen` to emit the .xcodeproj, then set the signing team in Xcode.
- [x] Decide monorepo `/ios` folder vs. separate repo; add Swift `.gitignore`. - Monorepo
      `/ios` folder (shares docs/schema/test creds with the web client); `ios/.gitignore`.
- [x] Dev/prod build configs (.xcconfig) carrying each Supabase URL + publishable anon
      key (dev `wwzvwjhohkyudytoqvfl`, prod `kxiyvqpmmfbibeoygmnw`). Never embed
      service_role. - `ios/Config/{Shared,Dev,Prod}.xcconfig`; Debug=dev, Release=prod;
      values flow into Info.plist keys and are read by `AppConfig.swift`. No service_role.
- [x] Add SPM deps: `supabase-swift`, GoogleSignIn-iOS (if native auth), image cropper. -
      Declared in `ios/project.yml` (supabase-swift 2.x, GoogleSignIn-iOS 7.x). No
      third-party cropper: a native SwiftUI cropper ports imageCropper.js exactly
      (see Decisions log).
- [x] Info.plist: display name, launch screen, photo-library usage string, OAuth URL scheme. -
      `ios/ReadingRoom/Support/Info.plist` (UILaunchScreen color, photo usage string,
      `$(GOOGLE_REVERSED_CLIENT_ID)` URL scheme, versions from xcconfig).
- [x] Bundle + register Crimson Pro + DM Mono fonts. - Downloaded OFL TTFs to
      `ios/ReadingRoom/Resources/Fonts/` (CrimsonPro variable + DMMono Regular/Medium
      + OFL licenses) and registered via UIAppFonts in Info.plist.

### Phase 4 - Supabase data layer in Swift
- [x] Singleton Supabase client (persist session, auto-refresh) mirroring supabaseClient.js. -
      `ios/ReadingRoom/Services/SupabaseService.swift` (Keychain session storage +
      auto-refresh are supabase-swift defaults; snake_case + Postgres-timestamp JSON
      coding configured on the client) + `App/AppConfig.swift` for env selection.
- [x] Port `src/api.js` as a Swift service layer (views never call Supabase directly).
      Cover: profiles, clubs/members (incl. myClubs de-dupe + counts), books, progress
      (+ myReadingHistory), reactions (RLS-gated), reviews, selections/votes, replies,
      engagements, announcements. - `ios/ReadingRoom/Services/API.swift` +
      `API+{Profiles,Clubs,Books,Progress,Reactions,Reviews,Selections,Engagements,Announcements}.swift`;
      every api.js function has a same-shaped Swift equivalent, including the myClubs
      duplicate-club fix, join-with-RETURNING, toggleEngagement, and the reaction/reply
      profile decoration.
- [x] Codable model structs for every table; snake_case decoding. -
      `ios/ReadingRoom/Models/Models.swift` (all 12 tables + enums matching DB check
      constraints) and `Models/JoinedModels.swift` (client-side join shapes).
- [x] `find_club_by_code` RPC via `.rpc(...)`. - `API+Clubs.swift` findClubByCode with
      a FoundClub result struct.
- [x] Open Library search via URLSession (keep 12s timeout + field list). -
      `ios/ReadingRoom/Services/OpenLibraryAPI.swift` (12s timeoutInterval, same
      fields=... list, limit 8, -M cover URLs, timed-out vs failed errors).
- [x] Storage: `avatars` + `club-images` upload/getPublicUrl, same path conventions. -
      `ios/ReadingRoom/Services/API+Storage.swift` (`<uid>/<millis>.jpg` and
      `<clubId>/<millis>.jpg`, upsert + image/jpeg, public URL returned).
- [x] Realtime channels (picker/book/feed/progress) with cleanup on view disappear
      (native equivalent of the router's onCleanup). -
      `ios/ReadingRoom/Services/RealtimeService.swift`: API.subscribe returns a
      RealtimeToken; RealtimeBag collects tokens per view model with the web's 400ms
      debounce and cancels them all in onDisappear/deinit.

### Phase 5 - Auth (Google OAuth, native)
- [x] Choose native GoogleSignIn (`signInWithIdToken`) vs. ASWebAuthenticationSession. -
      ASWebAuthenticationSession via Supabase signInWithOAuth (GoogleSignIn's nonce
      handling is unusable in 7.1.0 - see Decisions log); in
      `ios/ReadingRoom/Services/AuthService.swift`.
- [x] Register custom URL scheme; add redirect to Supabase Auth (dev + prod). - Redirect
      `com.jmalcolmo.thereadingroom://login-callback` (ASWebAuthenticationSession captures
      the scheme itself, no Info.plist URL type needed). USER STEP: add that URL to
      Supabase Auth -> URL Configuration -> Redirect URLs in the dev project (and prod
      before release).
- [x] Configure Google Cloud iOS OAuth client + reversed client ID scheme. - NOT NEEDED
      with the OAuth flow: it reuses the existing Google WEB client already configured in
      Supabase (the one powering the web app). The iOS client + Authorized Client IDs
      steps are obsolete. GoogleSignIn-iOS removed from `ios/project.yml`.
- [x] Handle callback, persist session (Keychain), port sign-out + auth-state store. -
      `Services/AuthService.swift` (sign-in/sign-out/URL handler) +
      `App/SessionStore.swift` (@Observable port of store.js + main.js boot: listens
      to authStateChanges, loads the profile, drives login vs app shell). Keychain
      persistence + auto-refresh are the supabase-swift client defaults.
- [ ] Test full loop on a real device (Google sign-in can't be tested headless). -
      USER STEP: needs the Google iOS client id (above) and a physical iPhone.

### Phase 6 - Port the 9 screens to SwiftUI
- [x] Navigation: NavigationStack + TabView matching the hash router + bottom tabs. -
      `ios/ReadingRoom/App/RootView.swift`: Route enum (club/picker/history/book) with a
      shared navigationDestination mapping; 4-tab TabView (Feed/Clubs/Progress/Profile)
      mirroring the web's bottom tab bar.
- [x] Shared theme layer (tokens, `.patch` card, stamp-title, buttons, fonts). -
      `ios/ReadingRoom/Theme/{Theme,PatchCard,Buttons,Formatters}.swift`: styles.css
      tokens with dark-mode twins, .patch() modifier (accent border + offset shadow +
      deterministic tilt), StampTitle, primary/ghost button styles, Crimson Pro/DM Mono.
- [x] login, feed (client-derived + engagements + announcements), clubs, club (roster +
      cover upload + admin), book (progress + page-tagged reactions + replies + realtime),
      picker (wheel/vote/pick + realtime; marker must match server result_user), history,
      progress (+ reaction-progress sync), profile (avatar upload + crop). - All 9 in
      `ios/ReadingRoom/Views/`: LoginView, FeedView (activity events + like-notifications
      + admin broadcast composer + 6 realtime channels), ClubsView (+ create/join sheets),
      ClubView (roster progress, join-code copy, cover upload, owner menu, Open Library
      add-book sheet with 350ms debounce + stale-response guard), BookView (composer +
      reaction-to-progress sync prompt whose dismissal still bumps the page, reviews
      unlock on finish, creator deadline/finish admin, 4 realtime channels), PickerView
      (SwiftUI wheel using shared WheelMath so the pointer always matches the recorded
      result_user, live vote with realtime tally + creator close, direct pick, race
      parked), HistoryView (avg ratings), MyProgressView (realtime), ProfileView.
      Engagement bars + reply threads shared via
      `Components/{EngagementBar,ReplyThreadView}.swift` (port of engage.js).
- [x] Native image cropping (PhotosUI) replacing imageCropper.js. -
      `Components/ImageCropperView.swift`: PhotosPicker feeds a pan/pinch cropper that
      bakes a 512x512 JPEG (0.9) exactly like the web cropper; used by profile avatar
      (circle) and club cover (rounded).
- [x] Toasts + loading/empty/error states per screen. - `App/ToastCenter.swift` overlay
      (3.2s, info/success/error) + per-screen ProgressView loading, EmptyStateView, and
      LoadErrorView with retry.

### Phase 7 - Native features
- [x] App icon + launch screen asset catalog (1024px master). -
      `ios/ReadingRoom/Resources/Assets.xcassets/` (AppIcon 1024 generated by
      `ios/Scripts/generate-icon.swift` - granny-square rounds + book stack;
      LaunchBackground + AccentColor colorsets; launch screen via UILaunchScreen).
      Note: the mark uses the Apple books emoji; if App Review objects to emoji
      artwork in the icon, re-run the script after swapping in a drawn book shape.
- [x] Decide push notifications (APNs + Edge Function) or skip. - SKIPPED for v1
      (Decisions log): no notifications table exists, feed is client-derived, realtime
      covers in-app liveness. No schema change needed, so schema.sql is untouched.
- [x] Optional deep links / universal links. - SKIPPED for v1 (Decisions log): no
      user-facing URLs exist to deep-link to; the only URL handling is the Google
      Sign-In callback scheme, which is wired.
- [x] Offline states, dark mode, Dynamic Type, accessibility, safe-area layout. -
      Built into the theme + screens: every screen has loading/empty/error-with-retry
      states (LoadErrorView surfaces network failures), all Theme colors have dark-mode
      variants, all fonts use Font.custom(relativeTo:) for Dynamic Type, engagement/
      avatar/progress components carry accessibility labels, and layout is
      ScrollView/safe-area native throughout (portrait iPhone).

### Phase 8 - Backend adjustments
- [x] Add iOS redirect URLs to Supabase Auth (dev + prod). - NOT NEEDED with native
      signInWithIdToken (no OAuth redirect through Supabase). The one dashboard step
      that IS needed (USER STEP, both projects): Supabase -> Authentication ->
      Providers -> Google -> add the iOS OAuth client id to "Authorized Client IDs",
      so token exchange accepts ID tokens whose audience is the iOS client.
- [x] Any new schema (e.g. push tokens) applied to BOTH projects + schema.sql
      (idempotent). - None required: push is skipped for v1 and every feature maps onto
      the existing tables. supabase/schema.sql is untouched by the iOS build.
- [x] Verify RLS spoiler-gating holds for the native client; confirm storage policies. -
      RLS is client-agnostic (same publishable key + PostgREST path as the web).
      Verified live against dev with the app's anon key: clubs/reactions/profiles
      SELECTs return empty sets for the anonymous role and find_club_by_code is
      permission-denied to anon (2026-07-02). The signed-in spoiler-gate matrix
      (p.30 visible / p.200 hidden, reply + engagement inheritance, review unlock,
      storage folder scoping) is codified in `ios/ReadingRoomTests/ServiceLayerTests.swift`
      and runs whenever the dev test-user creds are supplied (see Phase 9).
- [x] Revisit open rate-limit / abuse hardening before public store exposure. -
      Reviewed 2026-07-02. Already in place: find_club_by_code revoked from anon
      (kills unauthenticated code-space guessing), storage buckets capped at 2MB with
      an image-only MIME allowlist and per-folder write scoping, RLS on every table.
      Remaining exposure (unchanged by iOS, tracked for pre-launch): no per-user
      insert throttles on reactions/replies/engagements, and Supabase auth rate
      limits are at project defaults - revisit in the Supabase dashboard before the
      store listing goes live.

### Phase 9 - Testing
- [x] Unit-test the Swift service layer vs. dev project (mirror tests/run.mjs intent). -
      `ios/ReadingRoomTests/ServiceLayerTests.swift`: the full run.mjs sequence in Swift
      (club lifecycle, join-by-code + RETURNING, myClubs de-dupe, spoiler gate p.30/p.200,
      reply + engagement gate inheritance and gate-opening, review unlock, selections +
      vote authz, book/club delete gates, storage folder scoping, announcement authz,
      cascade cleanup). Signs in the same two DEV password users as the web test via
      scheme env vars; skips without creds and refuses to run against prod.
      `WheelMathTests.swift` adds the wheel marker==winner sweep (n=2..12) plus
      Postgres-timestamp parser round-trips.
- [ ] XCUITest for critical flows; device matrix (SE -> Pro Max), light/dark, slow net. -
      Launch smoke + launch-perf tests exist (`ios/ReadingRoomUITests/LaunchSmokeTests.swift`;
      deeper flows are blocked on Google sign-in, which can't be automated). USER STEP:
      run the matrix on hardware/simulators once the Google iOS client id is configured.
- [ ] Verify realtime + subscription cleanup; Instruments for leaks. - Cleanup is
      structural (RealtimeBag cancels every channel in onDisappear AND deinit; tokens
      also self-cancel on deinit) and vote/book/feed channels were built against that
      contract. USER STEP: confirm with Instruments (Leaks) on device once buildable -
      needs Xcode, which this machine doesn't have.

### Phase 10 - App Store assets + metadata
- [ ] App Store Connect record; metadata; keywords; category. - Paste-ready drafts in
      `ios/AppStore/metadata.md` (name/subtitle/description/keywords/categories/URLs).
      USER STEP: creating the record needs App Store Connect access.
- [x] App Privacy nutrition label + hosted Privacy Policy URL. - Label answers drafted
      in `ios/AppStore/privacy-nutrition-label.md` (no tracking, no analytics; UGC +
      Google account data linked to user). Privacy policy page added at repo-root
      `privacy.html` (standalone, touches no web-app code) - serves at
      https://jmalcolmo.github.io/bookclub/privacy.html once merged to main.
- [ ] Age rating; screenshots (6.7"/6.9" min); 1024 icon. - 1024 icon DONE (asset
      catalog + generator script). Age-rating questionnaire answers drafted in
      metadata.md. USER STEP: capture screenshots per `ios/AppStore/screenshots-plan.md`
      once the app builds in Xcode.
- [ ] Pricing/availability; App Review notes + a reviewer/demo login (Google auth caveat). -
      Pricing (free) + availability drafted in metadata.md; reviewer notes, the demo
      Google account plan, and the three known review risks (emoji icon, UGC
      moderation, missing in-app account deletion - the likeliest rejection) are in
      `ios/AppStore/review-notes.md`. USER STEP: create the demo Google account and
      enter everything in App Store Connect.

### Phase 11 - Build, TestFlight, submission

Everything below the first item is **account-gated** (needs the enrolled Apple
Developer account + a signing team). The project is prepared up to that boundary:
generate the .xcodeproj with `cd ios && xcodegen`, set the Team, and the Release
scheme archives against prod out of the box.

- [ ] Distribution cert + App Store provisioning profile (auto-signing or fastlane match). -
      AWAITS ACCOUNT. Project is set to CODE_SIGN_STYLE=Automatic; setting the Team in
      Xcode (or DEVELOPMENT_TEAM in ios/project.yml) is the only change needed.
- [x] Release scheme -> prod Supabase; set version + build number. - DONE in
      `ios/project.yml` (the ReadingRoom scheme archives with the Release config, which
      loads `Config/Prod.xcconfig` -> prod project `kxiyvqpmmfbibeoygmnw`) and
      `Config/Shared.xcconfig` (MARKETING_VERSION 1.0.0 / CURRENT_PROJECT_VERSION 1,
      flowing into Info.plist).
- [ ] Archive, validate, upload (Organizer / fastlane pilot). - AWAITS ACCOUNT.
- [ ] TestFlight internal (then external) testing; iterate on fixes. - AWAITS ACCOUNT.
- [ ] Attach final build, complete metadata, submit for review, handle rejections. -
      AWAITS ACCOUNT. Resolve the account-deletion risk in
      `ios/AppStore/review-notes.md` before submitting.
- [ ] Publish to the App Store. - AWAITS ACCOUNT.

## Related
- `docs/pwa-conversion.md` - SUPERSEDED as a mobile/store strategy. Retained only for
  web-secondary polish (the responsive audit keeps the web version lovely). Not a path
  to the App Store.

## Decisions log

Locked while executing Phases 3-11 (2026-07-02). Each entry: decision + one-line why.

- **SwiftUI throughout, including the spin wheel.** The wheel is plain 2D geometry
  (slices + labels + an eased rotation); SwiftUI Shape/Canvas handles it without
  bringing in UIKit/SpriteKit.
- **Minimum iOS 17.** Enables @Observable view models and modern NavigationStack APIs;
  a book-club audience on iPhone overwhelmingly runs 17+.
- **Google sign-in via Supabase signInWithOAuth (ASWebAuthenticationSession).**
  Originally scoped as native GoogleSignIn + signInWithIdToken, but that path is broken
  with GoogleSignIn 7.1.0: it builds on AppAuth, which auto-embeds a nonce in the ID
  token and exposes no way to read/set it, so Supabase's signInWithIdToken fails its
  "nonce on both sides or neither" check every time (verified on device 2026-07-02,
  error "Passed nonce and nonce in id_token should either both exist or not").
  Switched to the OAuth web-session flow (the backlog's listed alternative): the
  handshake happens server-side, and it reuses the same Google WEB OAuth client that
  already powers the web app - so the separate iOS OAuth client and the Supabase
  "Authorized Client IDs" step are no longer needed. Redirect URL:
  `com.jmalcolmo.thereadingroom://login-callback` (must be in Supabase Auth -> URL
  Configuration -> Redirect URLs). GoogleSignIn-iOS dropped as a dependency.
- **iPhone-only, portrait-only, v1.** Matches the "readers on their phone" product
  decision; Universal/iPad can come later.
- **Push notifications skipped for v1.** The feed is derived client-side and there is
  no notifications table; realtime in-app updates cover the social loop.
- **Env selection is build-time, not hostname.** Debug builds -> dev Supabase,
  Release/Archive -> prod, via xcconfig -> Info.plist -> AppConfig (the iOS analogue
  of config.js's hostname check).
- **No third-party image-cropper dependency.** imageCropper.js is ~150 lines of
  pan/zoom/bake logic; a native SwiftUI port (`Components/ImageCropperView.swift`)
  reproduces it exactly (512px square JPEG output) with zero added deps.
- **Theme rebuilt natively, faithfully.** styles.css tokens become a Swift Theme enum
  (same hex values), .patch cards become a PatchCard view (thick accent border, offset
  shadow, slight rotation), Crimson Pro/DM Mono bundled. The SVG grain overlay is
  dropped (costly full-screen blend, invisible at phone size).
- **Deep links skipped for v1.** Nothing in the product hands out URLs yet (clubs are
  joined by code, not link); the only registered scheme is the Google Sign-In callback.
- **Web-to-native behavior swaps.** Hash routes -> NavigationStack value routing +
  TabView; JS confirm() -> SwiftUI confirmationDialog/alert; HTML file inputs ->
  PhotosPicker; hover tooltips on like/emoji chips -> tap-and-hold context menu showing
  names; copy-to-clipboard button -> UIPasteboard + toast; the feed's off-canvas
  drawer rails -> in-feed horizontal sections (clubs strip + reading strip).
