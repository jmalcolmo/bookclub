// Profiles (port of the PROFILES section of src/api.js).

import Foundation
import Supabase

extension API {
    static func getProfile(_ userId: UUID) async throws -> Profile {
        try await supabase.from("profiles")
            .select()
            .eq("id", value: userId.uuidString)
            .single()
            .execute().value
    }

    static func getProfiles(_ ids: [UUID]) async throws -> [Profile] {
        guard !ids.isEmpty else { return [] }
        return try await supabase.from("profiles")
            .select()
            .in("id", values: ids.map { $0.uuidString })
            .execute().value
    }

    struct ProfileChanges: Encodable, Sendable {
        var displayName: String?
        var bio: String?
        var avatarUrl: String?
    }

    @discardableResult
    static func updateProfile(_ userId: UUID, changes: ProfileChanges) async throws -> Profile {
        try await supabase.from("profiles")
            .update(changes)
            .eq("id", value: userId.uuidString)
            .select()
            .single()
            .execute().value
    }
}
