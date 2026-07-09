// Club posts (port of the CLUB POSTS section of src/api.js). Lightweight
// Twitter/X-style posts scoped to a club: a short text update OR a single photo.
// These are NOT reviews and carry NO page number, so there is NO spoiler gate —
// but they ARE club-member-scoped. RLS (posts_select_member) only returns posts
// to members of the club, so whatever comes back is already safe to show; the
// app never re-implements access control client-side. posts_insert_member limits
// writes to members, and only the author can edit/delete their own.

import Foundation
import Supabase

extension API {
    // A club's posts, newest first, decorated with each author's profile.
    static func clubPosts(_ clubId: UUID) async throws -> [PostItem] {
        let rows: [ClubPost] = try await supabase.from("club_posts")
            .select()
            .eq("club_id", value: clubId.uuidString)
            .order("created_at", ascending: false)
            .execute().value
        let profiles = try await profilesById(rows.map(\.userId))
        return rows.map { PostItem(post: $0, profile: profiles[$0.userId]) }
    }

    // Upload a post photo to the 'post-images' bucket under the club's folder
    // (member-scoped by storage RLS) and return its public URL. Same path
    // convention as club covers: `${clubId}/${Date.now()}.jpg`.
    static func uploadPostImage(clubId: UUID, jpegData: Data) async throws -> String {
        let path = "\(clubId.uuidString.lowercased())/\(postMillisNow()).jpg"
        try await supabase.storage.from("post-images")
            .upload(path, data: jpegData,
                    options: FileOptions(contentType: "image/jpeg", upsert: true))
        return try supabase.storage.from("post-images")
            .getPublicURL(path: path).absoluteString
    }

    private struct NewPost: Encodable {
        let clubId: UUID
        let userId: UUID
        let body: String?
        let imageUrl: String?
    }

    // Create a post. At least one of body / imageUrl must be non-empty (the table
    // CHECK enforces it too); body is trimmed to nil when blank so a photo-only
    // post stores no empty string.
    @discardableResult
    static func addPost(clubId: UUID, body: String?, imageUrl: String?) async throws -> ClubPost {
        let uid = try await currentUserId()
        let text = (body ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return try await supabase.from("club_posts")
            .insert(NewPost(clubId: clubId, userId: uid,
                            body: text.isEmpty ? nil : text,
                            imageUrl: (imageUrl?.isEmpty ?? true) ? nil : imageUrl))
            .select()
            .single()
            .execute().value
    }

    // Fan a single composed post out to several clubs at once (the "+" compose
    // hub's "Create post" action, which carries a club multi-select). One
    // club_posts row is inserted per club via the existing addPost path, so RLS
    // (posts_insert_member) still authorizes each write independently — a
    // non-member club id simply fails its own insert. The image, if any, is
    // uploaded ONCE by the caller and its public URL shared across all rows
    // (post-images objects are publicly readable). Returns the created rows; a
    // per-club failure throws (earlier rows are not rolled back).
    @discardableResult
    static func addPostToClubs(clubIds: [UUID], body: String?, imageUrl: String?) async throws -> [ClubPost] {
        let ids = Array(Set(clubIds))
        guard !ids.isEmpty else {
            throw NSError(domain: "ReadingRoom", code: 0,
                          userInfo: [NSLocalizedDescriptionKey: "Pick at least one club"])
        }
        var rows: [ClubPost] = []
        for clubId in ids {
            rows.append(try await addPost(clubId: clubId, body: body, imageUrl: imageUrl))
        }
        return rows
    }

    private struct PostEdit: Encodable {
        let body: String
    }

    // Edit my own post's text. RLS (posts_update_own) only lets the author update.
    @discardableResult
    static func updatePost(_ id: UUID, body: String) async throws -> ClubPost {
        try await supabase.from("club_posts")
            .update(PostEdit(body: body))
            .eq("id", value: id.uuidString)
            .select()
            .single()
            .execute().value
    }

    static func deletePost(_ id: UUID) async throws {
        try await supabase.from("club_posts")
            .delete()
            .eq("id", value: id.uuidString)
            .execute()
    }

    private static func postMillisNow() -> Int {
        Int(Date().timeIntervalSince1970 * 1000)
    }
}
