// Push device-token registration (iOS-only; the web app has no push, but this
// mirrors the registerDeviceToken() added to src/api.js). Owner-only under RLS;
// unique on token, so re-registering upserts.

import Foundation
import Supabase

extension API {
    private struct DeviceTokenUpsert: Encodable {
        let userId: UUID
        let token: String
        let platform: String
        let environment: String
        let updatedAt: Date
    }

    // Store this device's APNs token so the push Edge Function can find who to
    // notify. `environment` is "sandbox" for dev/Debug builds, "production" for
    // App Store builds (matches the aps-environment entitlement).
    @discardableResult
    static func registerDeviceToken(
        _ token: String,
        environment: String = "sandbox"
    ) async throws -> IdRow {
        let uid = try await currentUserId()
        let row = DeviceTokenUpsert(
            userId: uid,
            token: token,
            platform: "ios",
            environment: environment,
            updatedAt: Date()
        )
        return try await supabase.from("device_tokens")
            .upsert(row, onConflict: "token")
            .select("id")
            .single()
            .execute().value
    }
}
