// Stories (port of the STORIES section of src/api.js). Ephemeral (72h) personal
// posts: a single photo and/or a short caption that self-expires. NOT tied to a
// club and NOT spoiler-gated. RLS (stories_select_audience) only ever returns
// UNEXPIRED stories the reader is entitled to — their own, a followee's, or a
// club-mate's (shares_any_club) — so whatever comes back is already safe to
// show; the app never re-implements that gate. story_views is a private
// per-viewer seen flag (story_views_select/insert_own). Photos reuse the
// user-scoped 'avatars' bucket under `${user.id}/stories/...`.

import Foundation
import Supabase

extension API {
    // Upload a story photo to the 'avatars' bucket under the author's own folder
    // (user-scoped by storage RLS) and return its public URL. Keyed by the
    // uploader's uid so it passes avatars_insert_own; a `stories/` sub-path keeps
    // it distinct from the profile avatar object.
    static func uploadStoryImage(jpegData: Data) async throws -> String {
        let uid = try await currentUserId()
        let path = "\(uid.uuidString.lowercased())/stories/\(storyMillisNow()).jpg"
        try await supabase.storage.from("avatars")
            .upload(path, data: jpegData,
                    options: FileOptions(contentType: "image/jpeg", upsert: true))
        return try supabase.storage.from("avatars")
            .getPublicURL(path: path).absoluteString
    }

    private struct NewStory: Encodable {
        let userId: UUID
        let body: String?
        let imageUrl: String?
    }

    // Post a story. At least one of body / imageUrl must be non-empty (the table
    // CHECK enforces it too); body is trimmed to nil when blank so a photo-only
    // story stores no empty string. expiresAt is server-set (createdAt + 72h).
    @discardableResult
    static func addStory(body: String?, imageUrl: String?) async throws -> Story {
        let uid = try await currentUserId()
        let text = (body ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return try await supabase.from("stories")
            .insert(NewStory(userId: uid,
                             body: text.isEmpty ? nil : text,
                             imageUrl: (imageUrl?.isEmpty ?? true) ? nil : imageUrl))
            .select()
            .single()
            .execute().value
    }

    // Delete my own story (take it down early). RLS (stories_delete_own)
    // restricts this to the author.
    static func deleteStory(_ id: UUID) async throws {
        try await supabase.from("stories")
            .delete()
            .eq("id", value: id.uuidString)
            .execute()
    }

    private struct ViewedStoryRow: Decodable { let storyId: UUID }

    // Active (unexpired, audience-visible) stories, GROUPED BY AUTHOR and ready
    // for the strip + viewer. RLS returns only stories I may see and only the
    // unexpired ones, so no client-side expiry/visibility filtering is needed.
    // Groups are ordered: mine first, then groups with any unseen story (newest
    // first), then fully-seen groups.
    static func activeStories() async throws -> [StoryGroup] {
        let myId = try await currentUserId()

        let rows: [Story] = try await supabase.from("stories")
            .select()
            .order("created_at", ascending: true)
            .execute().value
        guard !rows.isEmpty else { return [] }

        // Which of these have I already seen? Only my own view rows come back.
        let ids = rows.map { $0.id.uuidString }
        let views: [ViewedStoryRow] = try await supabase.from("story_views")
            .select("story_id")
            .eq("viewer_id", value: myId.uuidString)
            .in("story_id", values: ids)
            .execute().value
        let seen = Set(views.map(\.storyId))

        let profiles = try await profilesById(rows.map(\.userId))

        // Group by author, preserving oldest→newest order within each group.
        var order: [UUID] = []
        var byAuthor: [UUID: [StoryItem]] = [:]
        for r in rows {
            if byAuthor[r.userId] == nil { order.append(r.userId) }
            byAuthor[r.userId, default: []].append(StoryItem(story: r, seen: seen.contains(r.id)))
        }

        let groups = order.map { uid in
            StoryGroup(userId: uid, profile: profiles[uid],
                       stories: byAuthor[uid] ?? [], isMine: uid == myId)
        }

        return groups.sorted { a, b in
            if a.isMine != b.isMine { return a.isMine }           // mine first
            if a.allSeen != b.allSeen { return !a.allSeen }        // unseen before seen
            return a.latest > b.latest                             // newest first
        }
    }

    private struct NewStoryView: Encodable {
        let storyId: UUID
        let viewerId: UUID
    }

    // Record that I've viewed a story (idempotent upsert on the unique
    // (story_id, viewer_id)). RLS (story_views_insert_own) forces viewerId to me.
    static func markStoryViewed(_ storyId: UUID) async throws {
        let uid = try await currentUserId()
        try await supabase.from("story_views")
            .upsert(NewStoryView(storyId: storyId, viewerId: uid),
                    onConflict: "story_id,viewer_id")
            .execute()
    }

    private static func storyMillisNow() -> Int {
        Int(Date().timeIntervalSince1970 * 1000)
    }
}
