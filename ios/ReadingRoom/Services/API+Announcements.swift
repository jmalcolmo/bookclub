// Announcements: global broadcasts the app admin pushes to every user (port of
// the ANNOUNCEMENTS section of src/api.js). Everyone can read; only an admin
// can post (RLS). Per-user dismissal is tracked server-side so "seen" persists
// across devices.

import Foundation
import Supabase

extension API {
    // Announcements I haven't dismissed, newest first.
    static func activeAnnouncements() async throws -> [Announcement] {
        let uid = try await currentUserId()

        async let annsReq: [Announcement] = supabase.from("announcements")
            .select()
            .order("created_at", ascending: false)
            .execute().value

        struct ReadSlice: Codable { let announcementId: UUID }
        async let readsReq: [ReadSlice] = supabase.from("announcement_reads")
            .select("announcement_id")
            .eq("user_id", value: uid.uuidString)
            .execute().value

        let (anns, reads) = try await (annsReq, readsReq)
        let dismissed = Set(reads.map(\.announcementId))
        return anns.filter { !dismissed.contains($0.id) }
    }

    private struct ReadUpsert: Encodable {
        let announcementId: UUID
        let userId: UUID
    }

    static func dismissAnnouncement(_ announcementId: UUID) async throws {
        let uid = try await currentUserId()
        try await supabase.from("announcement_reads")
            .upsert(ReadUpsert(announcementId: announcementId, userId: uid),
                    onConflict: "announcement_id,user_id")
            .execute()
    }

    private struct NewAnnouncement: Encodable {
        let body: String
        let createdBy: UUID
    }

    @discardableResult
    static func postAnnouncement(body: String) async throws -> Announcement {
        let uid = try await currentUserId()
        return try await supabase.from("announcements")
            .insert(NewAnnouncement(body: body, createdBy: uid))
            .select()
            .single()
            .execute().value
    }
}
