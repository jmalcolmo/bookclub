// Reactions + threaded replies (port of the REACTIONS and REACTION REPLIES
// sections of src/api.js). SELECTs only return rows RLS lets us see (the
// spoiler gate), so whatever comes back is already safe to display - the app
// never re-implements gating client-side.

import Foundation
import Supabase

extension API {
    static func bookReactions(_ bookId: UUID) async throws -> [ReactionItem] {
        let rows: [Reaction] = try await supabase.from("reactions")
            .select()
            .eq("book_id", value: bookId.uuidString)
            .order("page", ascending: true)
            .order("created_at", ascending: true)
            .execute().value
        let profiles = try await profilesById(rows.map(\.userId))
        return rows.map { ReactionItem(reaction: $0, profile: profiles[$0.userId]) }
    }

    private struct NewReaction: Encodable {
        let bookId: UUID
        let userId: UUID
        let page: Int
        let body: String
    }

    @discardableResult
    static func addReaction(bookId: UUID, page: Int, body: String) async throws -> Reaction {
        let uid = try await currentUserId()
        return try await supabase.from("reactions")
            .insert(NewReaction(bookId: bookId, userId: uid, page: page, body: body))
            .select()
            .single()
            .execute().value
    }

    private struct ReactionEdit: Encodable {
        let page: Int
        let body: String
    }

    // Edit my own reaction (body + page). RLS (reactions_update_own) only lets the
    // author update; the spoiler gate is a SELECT concern and stays intact.
    @discardableResult
    static func updateReaction(_ id: UUID, page: Int, body: String) async throws -> Reaction {
        try await supabase.from("reactions")
            .update(ReactionEdit(page: page, body: body))
            .eq("id", value: id.uuidString)
            .select()
            .single()
            .execute().value
    }

    static func deleteReaction(_ id: UUID) async throws {
        try await supabase.from("reactions")
            .delete()
            .eq("id", value: id.uuidString)
            .execute()
    }

    // Replies for a set of reactions, fetched in bulk to avoid N+1. RLS makes a
    // reply visible only when its parent reaction is (it inherits the spoiler
    // gate), so whatever comes back is safe to show.
    static func reactionReplies(reactionIds: [UUID]) async throws -> [ReplyItem] {
        guard !reactionIds.isEmpty else { return [] }
        let rows: [ReactionReply] = try await supabase.from("reaction_replies")
            .select()
            .in("reaction_id", values: reactionIds.map { $0.uuidString })
            .order("created_at", ascending: true)
            .execute().value
        let profiles = try await profilesById(rows.map(\.userId))
        return rows.map { ReplyItem(reply: $0, profile: profiles[$0.userId]) }
    }

    private struct NewReply: Encodable {
        let reactionId: UUID
        let userId: UUID
        let body: String
    }

    @discardableResult
    static func addReply(reactionId: UUID, body: String) async throws -> ReactionReply {
        let uid = try await currentUserId()
        return try await supabase.from("reaction_replies")
            .insert(NewReply(reactionId: reactionId, userId: uid, body: body))
            .select()
            .single()
            .execute().value
    }

    private struct ReplyEdit: Encodable {
        let body: String
    }

    // Edit my own reply. RLS (replies_update_own) only lets the author update; the
    // reply keeps inheriting its parent reaction's spoiler gate.
    @discardableResult
    static func updateReply(_ id: UUID, body: String) async throws -> ReactionReply {
        try await supabase.from("reaction_replies")
            .update(ReplyEdit(body: body))
            .eq("id", value: id.uuidString)
            .select()
            .single()
            .execute().value
    }

    static func deleteReply(_ id: UUID) async throws {
        try await supabase.from("reaction_replies")
            .delete()
            .eq("id", value: id.uuidString)
            .execute()
    }
}
