// Reactions + threaded replies (port of the REACTIONS and REACTION REPLIES
// sections of src/api.js). SELECTs only return rows RLS lets us see (the
// spoiler gate), so whatever comes back is already safe to display - the app
// never re-implements gating client-side.

import Foundation
import Supabase

// One reader's OWN footprint on a single book (API.userBookInvolvement): the
// reactions they wrote, the replies they wrote (each carrying the parent
// reaction they answered), and their reading-progress row - keyed by bookId +
// ownerId. Every row arrives already filtered by RLS (the spoiler gate), so the
// view never re-implements gating. Reached from a profile shelf tap.
struct InvolvementReply: Identifiable, Hashable, Sendable {
    let reply: ReactionReply
    let parent: Reaction          // the reaction this reply answers (on this book)
    var id: UUID { reply.id }
}

struct BookInvolvement: Sendable {
    let book: Book
    let owner: Profile?
    let reactions: [ReactionItem]    // the owner's, page-ordered
    let replies: [InvolvementReply]  // the owner's, on this book
    let progress: ReadingProgress?   // the owner's single row, or nil if hidden
}

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

    // One reader's OWN footprint on a single book: the reactions + replies they
    // wrote and their reading-progress row (port of api.js userBookInvolvement).
    // Every row comes back through RLS - the spoiler gate lives server-side only,
    // so whatever returns is safe to render and the app never re-gates. Keyed by
    // bookId + ownerId; reached from a profile shelf tap.
    static func userBookInvolvement(bookId: UUID, userId: UUID) async throws -> BookInvolvement {
        async let bookReq = API.getBook(bookId)
        async let ownerReq: Profile? = try? await API.getProfile(userId)

        async let reactionsReq: [Reaction] = supabase.from("reactions")
            .select()
            .eq("book_id", value: bookId.uuidString)
            .eq("user_id", value: userId.uuidString)
            .order("page", ascending: true)
            .order("created_at", ascending: true)
            .execute().value
        async let progressReq: [ReadingProgress] = supabase.from("reading_progress")
            .select()
            .eq("book_id", value: bookId.uuidString)
            .eq("user_id", value: userId.uuidString)
            .execute().value

        let (book, owner, reactions, progressRows) =
            try await (bookReq, ownerReq, reactionsReq, progressReq)

        // The owner's replies, then resolve their parent reactions and keep only
        // the ones whose parent is on THIS book. RLS returns a reply only when its
        // parent reaction is visible (it inherits the parent's spoiler gate), so
        // the parent is guaranteed readable too.
        let myReplies: [ReactionReply] = try await supabase.from("reaction_replies")
            .select()
            .eq("user_id", value: userId.uuidString)
            .order("created_at", ascending: true)
            .execute().value
        let parentIds = Array(Set(myReplies.map(\.reactionId)))
        let parents: [Reaction] = parentIds.isEmpty ? [] : try await supabase.from("reactions")
            .select()
            .in("id", values: parentIds.map { $0.uuidString })
            .eq("book_id", value: bookId.uuidString)
            .execute().value
        let parentById = Dictionary(uniqueKeysWithValues: parents.map { ($0.id, $0) })
        let replies: [InvolvementReply] = myReplies.compactMap { r in
            guard let parent = parentById[r.reactionId] else { return nil }
            return InvolvementReply(reply: r, parent: parent)
        }

        let reactionItems = reactions.map { ReactionItem(reaction: $0, profile: owner) }
        return BookInvolvement(book: book, owner: owner,
                               reactions: reactionItems, replies: replies,
                               progress: progressRows.first)
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
