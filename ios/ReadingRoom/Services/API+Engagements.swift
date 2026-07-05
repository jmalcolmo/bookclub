// Engagements: likes + emoji tapbacks on ANY feed item (port of the
// ENGAGEMENTS section of src/api.js). Polymorphic (target_type, target_id);
// RLS only returns engagements on targets the reader can see, so they can
// never leak a hidden reaction or review.
//
// target_id values are uuids, globally unique across tables, so one IN query
// fetches everything for a screen's worth of items; callers group by targetId.

import Foundation
import Supabase

extension API {
    static func engagementsFor(targetIds: [UUID]) async throws -> [Engagement] {
        guard !targetIds.isEmpty else { return [] }
        return try await supabase.from("engagements")
            .select()
            .in("target_id", values: targetIds.map { $0.uuidString })
            .execute().value
    }

    private struct NewEngagement: Encodable {
        let targetType: EngagementTarget
        let targetId: UUID
        let userId: UUID
        let kind: String
    }

    // Toggle a like/emoji for the current user: remove it if present, else add.
    // Returns true if the engagement is now ON, false if it was removed.
    @discardableResult
    static func toggleEngagement(targetType: EngagementTarget, targetId: UUID, kind: String) async throws -> Bool {
        let uid = try await currentUserId()
        let existing: [IdRow] = try await supabase.from("engagements")
            .select("id")
            .eq("target_type", value: targetType.rawValue)
            .eq("target_id", value: targetId.uuidString)
            .eq("user_id", value: uid.uuidString)
            .eq("kind", value: kind)
            .execute().value

        if let first = existing.first {
            try await supabase.from("engagements")
                .delete()
                .eq("id", value: first.id.uuidString)
                .execute()
            return false
        }
        try await supabase.from("engagements")
            .insert(NewEngagement(targetType: targetType, targetId: targetId, userId: uid, kind: kind))
            .execute()
        return true
    }
}
