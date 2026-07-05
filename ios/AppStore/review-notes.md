# App Review notes + demo access (draft)

## The Google-auth caveat

The app signs in exclusively with Google (native GoogleSignIn ->
Supabase signInWithIdToken). App Review requires a working demo login, and
"sign in with your own Google account" is not acceptable. Plan:

1. Create a dedicated Google account for review (e.g.
   readingroom.appreview@gmail.com) with 2FA DISABLED or an app password
   documented, and pre-join it to a demo club populated with a current book,
   reactions at several pages, reviews, and an open vote (the repo's
   `seed-feed` tooling can populate the DEV project; for review this must be
   done once against PROD with innocuous content).
2. Put the account email + password in the App Review "Sign-in required"
   fields.
3. In the notes, explain the spoiler gate explicitly (below) so gated content
   isn't mistaken for a bug.

## Suggested reviewer notes text

> Sign in with the provided Google account (tap "Continue with Google" and
> enter the credentials). The account is pre-joined to the "Reading Room
> Demo" club.
>
> Core concept: reactions are tagged to a page number and are HIDDEN from
> members who haven't logged reading progress up to that page - that is the
> product's spoiler protection, enforced server-side. If a reaction seems
> "missing," update "my progress" on the book screen and it will appear.
> Reviews unlock after marking the book finished.
>
> All social content is private to club members. Users can delete their own
> posts; club creators can remove members and delete the club.

## Known review risks

- **Icon artwork:** the current icon uses the Apple books emoji as its center
  mark. If review flags Apple-owned artwork, swap the emoji draw call in
  `ios/Scripts/generate-icon.swift` for a drawn book shape and regenerate.
- **UGC expectations:** reviewers look for report/block in social apps. v1's
  position: content is only visible inside private, code-joined clubs; authors
  can delete their own content; owners can remove members and delete clubs.
  If review pushes back, a lightweight "report to club owner" affordance is
  the smallest compliant addition.
- **Account deletion:** Apple requires in-app account deletion for apps with
  account creation (guideline 5.1.1(v)). v1 has sign-out but NO account
  deletion UI. Options before submission: add a "Delete account" button
  calling a small SECURITY DEFINER RPC (deletes auth.users row; FK cascades
  wipe profile/memberships/content), or gate v1 to TestFlight until added.
  Flagged as the single most likely rejection - resolve before submitting.
