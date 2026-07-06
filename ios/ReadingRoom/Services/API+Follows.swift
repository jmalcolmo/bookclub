// Follows (port of the FOLLOWS section of src/api.js). A follow graph OUTSIDE
// of clubs: I can follow another reader and then see the SOLO reading they do in
// clubs I'm not part of (their own progress + reactions). RLS enforces every
// rule - the follows_* policies plus the additive follow paths on
// profiles/books/reactions/reading_progress. The club spoiler gate is never
// widened: inside a shared club it stays the sole authority.

import Foundation
import Supabase

extension API {
    private struct FolloweeRow: Decodable { let followeeId: UUID }

    // The followee_id list for everyone I currently follow (newest first).
    static func following() async throws -> [UUID] {
        let uid = try await currentUserId()
        let rows: [FolloweeRow] = try await supabase.from("follows")
            .select("followee_id")
            .eq("follower_id", value: uid.uuidString)
            .order("created_at", ascending: false)
            .execute().value
        return rows.map(\.followeeId)
    }

    // The people I follow, decorated with their profile (for the feed roster).
    static func followingProfiles() async throws -> [Profile] {
        let ids = try await following()
        guard !ids.isEmpty else { return [] }
        let byId = try await profilesById(ids)
        // Preserve follow order (profilesById returns a dict).
        return ids.compactMap { byId[$0] }
    }

    // Am I following one specific reader?
    static func isFollowing(_ userId: UUID) async throws -> Bool {
        let uid = try await currentUserId()
        let rows: [FolloweeRow] = try await supabase.from("follows")
            .select("followee_id")
            .eq("follower_id", value: uid.uuidString)
            .eq("followee_id", value: userId.uuidString)
            .execute().value
        return !rows.isEmpty
    }

    private struct NewFollow: Encodable {
        let followerId: UUID
        let followeeId: UUID
    }

    @discardableResult
    static func follow(_ userId: UUID) async throws -> Follow {
        let uid = try await currentUserId()
        return try await supabase.from("follows")
            .insert(NewFollow(followerId: uid, followeeId: userId))
            .select()
            .single()
            .execute().value
    }

    static func unfollow(_ userId: UUID) async throws {
        let uid = try await currentUserId()
        try await supabase.from("follows")
            .delete()
            .eq("follower_id", value: uid.uuidString)
            .eq("followee_id", value: userId.uuidString)
            .execute()
    }

    // The "people you follow" feed: for each reader I follow, their SOLO reading -
    // recent reactions and progress on books in clubs I'm NOT a member of. RLS
    // only ever returns follow-visible rows, so whatever comes back is safe to
    // show. Rows are decorated with the author's profile and book, newest first.
    static func followFeed(limit: Int = 40) async throws -> (items: [FollowFeedItem], followees: [Profile]) {
        let followees = try await followingProfiles()
        guard !followees.isEmpty else { return ([], []) }
        let ids = followees.map { $0.id.uuidString }
        let profileById = Dictionary(uniqueKeysWithValues: followees.map { ($0.id, $0) })

        async let reactionsReq: [Reaction] = supabase.from("reactions")
            .select()
            .in("user_id", values: ids)
            .order("created_at", ascending: false)
            .limit(limit)
            .execute().value
        async let progressReq: [ReadingProgress] = supabase.from("reading_progress")
            .select()
            .in("user_id", values: ids)
            .order("updated_at", ascending: false)
            .limit(limit)
            .execute().value

        let (reactions, progress) = try await (reactionsReq, progressReq)

        let bookIds = Array(Set(reactions.map(\.bookId) + progress.map(\.bookId)))
        let books: [Book] = bookIds.isEmpty ? [] : try await supabase.from("books")
            .select()
            .in("id", values: bookIds.map { $0.uuidString })
            .execute().value
        let bookById = Dictionary(uniqueKeysWithValues: books.map { ($0.id, $0) })

        var items: [FollowFeedItem] = []
        items += reactions.map { r in
            FollowFeedItem(kind: .reaction, id: r.id, at: r.createdAt,
                           profile: profileById[r.userId], book: bookById[r.bookId],
                           page: r.page, body: r.body, status: nil)
        }
        items += progress.map { p in
            FollowFeedItem(kind: .progress, id: p.id, at: p.updatedAt,
                           profile: profileById[p.userId], book: bookById[p.bookId],
                           page: p.currentPage, body: nil, status: p.status)
        }
        // Only surface rows we could resolve a book for (RLS may hide the book if
        // the follow path didn't apply), newest first.
        items = items
            .filter { $0.book != nil }
            .sorted { $0.at > $1.at }
        if items.count > limit { items = Array(items.prefix(limit)) }
        return (items, followees)
    }
}
