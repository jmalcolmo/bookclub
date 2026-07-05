# App Privacy "nutrition label" (draft answers)

Answers for App Store Connect -> App Privacy. Grounded in what the app
actually does: Supabase auth (Google), Postgres over RLS, public-read storage
buckets for avatars/club covers, no analytics SDK, no ads, no tracking.

## Data used to track you

**None.** No third-party advertising or cross-app tracking of any kind.

## Data linked to you

| Data type | What | Purpose |
|---|---|---|
| Contact info - Email address | Google account email via sign-in | App functionality (account) |
| Contact info - Name | Google display name (editable in-app) | App functionality (profile shown to clubmates) |
| User content - Photos | Avatar + club cover images (user-chosen, cropped) | App functionality |
| User content - Other | Reactions, replies, reviews, reading progress, votes | App functionality (the product itself) |
| Identifiers - User ID | Supabase auth UUID | App functionality |

## Data not collected

Location, health, financial, browsing history, search history, contacts,
diagnostics/analytics (no crash/analytics SDK is bundled), advertising data.

## Notes for the reviewer form

- All data is stored in Supabase (Postgres + Storage) under row-level
  security; club content is only visible to club members.
- Avatars and club covers live in public-read storage buckets (unguessable
  URLs); everything else requires an authenticated, authorized session.
- Sign-in is exclusively Google OAuth via the native GoogleSignIn SDK;
  no passwords are collected by the app.
- Users can delete their own reactions/replies/reviews in-app; deleting a
  club (creator only) cascades all of its content.
