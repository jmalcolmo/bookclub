# send-push Edge Function

Delivers an APNs push in two cases:

1. **Progress update** — wire as a Database Webhook on `INSERT`/`UPDATE` of
   `public.reading_progress`. Notifies the other members of that book's club.
2. **Near-deadline / unfinished check** — invoke on a schedule with body
   `{"mode":"deadline-check"}`. Notifies members who haven't finished a book
   whose `deadline` is within the next 24h.

## NEEDS-HUMAN: required before any real push can be delivered

This function is complete code, but Apple push delivery cannot be faked in a
sandbox. A human with the Apple Developer account must do all of the following:

1. **Enable the Push Notifications capability on the App ID** in the Apple
   Developer portal, and regenerate/refresh the provisioning profile. (The
   `aps-environment` entitlement is already wired in
   `ios/ReadingRoom/Support/ReadingRoom.entitlements` via `ios/project.yml`.)
2. **Create an APNs Auth Key (.p8)** in the portal (Keys → new key → Apple Push
   Notifications service). Note its **Key ID** and your **Team ID**.
3. **Set the Supabase secrets** on the DEV project (then prod later, never here):
   ```
   supabase secrets set \
     APNS_KEY_ID=XXXXXXXXXX \
     APNS_TEAM_ID=YYYYYYYYYY \
     APNS_BUNDLE_ID=<your app bundle id, e.g. com.example.readingroom> \
     APNS_PRIVATE_KEY="$(cat AuthKey_XXXXXXXXXX.p8)"
   ```
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.
4. **Deploy the function:** `supabase functions deploy send-push`.
5. **Wire the triggers:**
   - Database Webhook: Dashboard → Database → Webhooks → new webhook on
     `reading_progress` (INSERT + UPDATE) → HTTP POST to this function's URL.
   - Schedule: pg_cron or the Dashboard scheduler → POST `{"mode":"deadline-check"}`.
6. **Run on a real iOS device** (the Simulator does not receive real APNs pushes)
   signed with a profile that has the push capability, so the app registers a
   device token into `device_tokens`.

Only after all of that will a `reading_progress` change or the deadline sweep
land a real notification on the phone.
