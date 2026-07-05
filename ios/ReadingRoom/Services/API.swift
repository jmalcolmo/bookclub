// All Supabase data access lives in the API namespace (this file + the
// API+*.swift extensions beside it). Views and view models call these; nobody
// else touches the client. RLS enforces every rule server-side (especially
// spoiler-gating) - the port of src/api.js.

import Foundation
import Supabase

enum API {
    // The signed-in user's id, from the current (auto-refreshed) session.
    // Mirrors the `(await supabase.auth.getUser()).data.user` calls in api.js.
    static func currentUserId() async throws -> UUID {
        try await supabase.auth.session.user.id
    }

    // Bulk (id -> Profile) lookup used to decorate rows with their authors.
    // Mirrors api.js getProfiles(); RLS only returns co-members' profiles.
    static func profilesById(_ ids: [UUID]) async throws -> [UUID: Profile] {
        let unique = Array(Set(ids))
        guard !unique.isEmpty else { return [:] }
        let profiles: [Profile] = try await supabase.from("profiles")
            .select()
            .in("id", values: unique.map { $0.uuidString })
            .execute().value
        return Dictionary(uniqueKeysWithValues: profiles.map { ($0.id, $0) })
    }
}

// Decoding helper for "select just the id" probes (e.g. toggleEngagement).
struct IdRow: Codable, Sendable {
    let id: UUID
}
