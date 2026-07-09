// Unlocked reactions (port of the UNLOCKED REACTIONS section of src/api.js).
//
// When a reader bumps progress past a page, other members' reactions in the
// crossed pages become visible (the spoiler gate opens). We record those as
// unseen `reaction_unlocks` and surface them in a dedicated space. The gate stays
// the sole authority: unlockedReactions runs a SECURITY INVOKER RPC (RLS still
// decides the result), the insert is guarded by reaction_visible(), and myUnlocks
// re-joins reactions under RLS and drops anything no longer visible.

import Foundation
import Supabase

extension API {
    // (fromPage, toPage] reactions by OTHER users now visible to me — the set my
    // latest progress bump unlocked. The RPC is SECURITY INVOKER, so the reactions
    // SELECT policy (spoiler gate) still applies; fromPage/toPage only bound the scan.
    static func unlockedReactions(bookId: UUID, fromPage: Int, toPage: Int)
        async throws -> [ReactionItem]
    {
        struct Params: Encodable {
            let bookId: UUID
            let fromPage: Int
            let toPage: Int
            enum CodingKeys: String, CodingKey {
                case bookId = "_book_id"
                case fromPage = "_from_page"
                case toPage = "_to_page"
            }
        }
        let rows: [Reaction] = try await supabase
            .rpc("unlocked_reactions",
                 params: Params(bookId: bookId, fromPage: fromPage, toPage: toPage))
            .execute().value
        let profiles = try await profilesById(rows.map(\.userId))
        return rows.map { ReactionItem(reaction: $0, profile: profiles[$0.userId]) }
    }

    private struct UnlockUpsert: Encodable {
        let userId: UUID
        let reactionId: UUID
    }

    // Record that a set of reactions unlocked for me (unseen). Idempotent on
    // (user_id, reaction_id); the merge payload carries only the keys, so an
    // existing row's unlocked_at/seen_at are left intact. RLS
    // (reaction_unlocks_insert_own_visible) re-checks each reaction is visible.
    static func recordUnlocks(_ reactionIds: [UUID]) async throws {
        guard !reactionIds.isEmpty else { return }
        let uid = try await currentUserId()
        let rows = reactionIds.map { UnlockUpsert(userId: uid, reactionId: $0) }
        try await supabase.from("reaction_unlocks")
            .upsert(rows, onConflict: "user_id,reaction_id")
            .execute()
    }

    // My unlock rows (optionally only unseen), decorated with reaction/book/author
    // and grouped-ready (newest first). Reactions/books come back RLS-filtered, so
    // any row whose reaction is no longer visible (deleted or re-locked) is dropped.
    static func myUnlocks(unseenOnly: Bool = false) async throws -> [UnlockItem] {
        let uid = try await currentUserId()
        var unlocks: [ReactionUnlock] = try await supabase.from("reaction_unlocks")
            .select()
            .eq("user_id", value: uid.uuidString)
            .order("unlocked_at", ascending: false)
            .execute().value
        if unseenOnly { unlocks = unlocks.filter { $0.seenAt == nil } }
        guard !unlocks.isEmpty else { return [] }

        let reactionIds = unlocks.map(\.reactionId)
        let reactions: [Reaction] = try await supabase.from("reactions")
            .select()
            .in("id", values: reactionIds.map { $0.uuidString })
            .execute().value
        let rById = Dictionary(uniqueKeysWithValues: reactions.map { ($0.id, $0) })
        let bookIds = Array(Set(reactions.map(\.bookId)))

        async let booksReq: [Book] = supabase.from("books")
            .select()
            .in("id", values: bookIds.map { $0.uuidString })
            .execute().value
        async let profilesReq = profilesById(reactions.map(\.userId))
        let (books, profiles) = try await (booksReq, profilesReq)
        let bById = Dictionary(uniqueKeysWithValues: books.map { ($0.id, $0) })

        return unlocks.compactMap { u -> UnlockItem? in
            guard let r = rById[u.reactionId], let b = bById[r.bookId] else { return nil }
            return UnlockItem(unlock: u, reaction: r, profile: profiles[r.userId], book: b)
        }
    }

    private struct SeenUpdate: Encodable { let seenAt: Date }

    // Mark unlock rows seen on viewing the Unlocked space. Owner-only under RLS.
    static func markUnlocksSeen(_ reactionIds: [UUID]) async throws {
        guard !reactionIds.isEmpty else { return }
        let uid = try await currentUserId()
        try await supabase.from("reaction_unlocks")
            .update(SeenUpdate(seenAt: Date()))
            .eq("user_id", value: uid.uuidString)
            .in("reaction_id", values: reactionIds.map { $0.uuidString })
            .execute()
    }
}
