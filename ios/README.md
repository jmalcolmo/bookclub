# The Reading Room - native iOS app

Native SwiftUI rebuild of The Reading Room (the primary product; the web app in
the repo root stays alive as a secondary client). Roadmap and status live in
`../docs/native-ios-app.md`.

## Layout

```
ios/
  project.yml            XcodeGen manifest (generates ReadingRoom.xcodeproj)
  Config/                .xcconfig per environment (dev/prod Supabase)
  ReadingRoom/
    App/                 entry point, config, session store, root shell, toasts
    Models/              Codable structs for every table (snake_case decoding)
    Services/            the ONLY layer that touches Supabase (port of src/api.js)
    Theme/               "Deranged Granny Square" tokens + shared components
    Components/          reusable view pieces (avatars, engagement bar, cropper...)
    Views/               the 9 screens
    Resources/           asset catalog + bundled fonts
    Support/Info.plist
  ReadingRoomTests/      service-layer tests vs the DEV project (mirror of tests/run.mjs)
  ReadingRoomUITests/    launch smoke test
  AppStore/              metadata drafts, privacy label, review notes
  Scripts/               icon generator
```

## One-time setup (on a Mac with Xcode 16+)

1. `brew install xcodegen`
2. `cd ios && xcodegen` -> open `ReadingRoom.xcodeproj`
3. In Xcode, set your Team on the ReadingRoom target (Signing & Capabilities).
4. Create an **iOS OAuth client** in the Google Cloud project that backs
   Supabase Google auth (APIs & Services -> Credentials -> Create credentials ->
   OAuth client ID -> iOS, bundle id `com.jmalcolmo.thereadingroom`). Paste the
   client id and the reversed client id into `Config/Shared.xcconfig`
   (`GOOGLE_CLIENT_ID` / `GOOGLE_REVERSED_CLIENT_ID`) and re-run `xcodegen`.
5. Run on a device or simulator. Debug builds hit the **dev** Supabase project;
   Release/Archive builds hit **prod** (same split as config.js on the web).

No redirect URL changes are needed in Supabase: the app uses native Google
Sign-In and exchanges the Google ID token via `signInWithIdToken`, so the OAuth
round-trip never goes through Supabase's redirect flow.

## Rules carried over from the web app

- **All DB access goes through `Services/`** (the `API` namespace). Views never
  touch the Supabase client directly.
- **Spoiler-gating is server-side (RLS).** The app never re-implements gating;
  whatever rows come back are safe to show.
- **Realtime subscriptions** are owned by view models and torn down in
  `onDisappear` (the native equivalent of the web router's `onCleanup`).
- Schema changes follow the repo ritual: apply to BOTH Supabase projects and
  mirror in `supabase/schema.sql` (this app required none).

## Tests

`ReadingRoomTests/ServiceLayerTests.swift` mirrors `tests/run.mjs`: it signs in
two DEV test users by password and drives the real database through RLS,
including the spoiler gate. Provide the same creds the web test uses via scheme
environment variables `TEST_A_EMAIL/PASSWORD`, `TEST_B_EMAIL/PASSWORD`
(see `.passwords/test-users.json`). Without creds those tests skip (XCTSkip);
the pure wheel-math tests always run.
