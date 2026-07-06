// Activity (port of api.js myActivity): who engaged with MY content — likes /
// emoji on my reactions, comments (replies), reviews and progress milestones,
// plus replies posted under my reactions. Everything is already reader-visible
// to me under RLS (I can always see my own rows, and engagements/replies on
// them route through those same gates), and anyone able to engage my content
// necessarily shares a club with me, so their profile resolves too.

import Foundation
import Supabase

extension API {
    static func myActivity(limit: Int = 30) async throws -> [ActivityItem] {
        let uid = try await currentUserId()
        let me = uid.uuidString

        async let reactionsReq: [Reaction] = supabase.from("reactions")
            .select().eq("user_id", value: me).execute().value
        async let repliesReq: [ReactionReply] = supabase.from("reaction_replies")
            .select().eq("user_id", value: me).execute().value
        async let reviewsReq: [Review] = supabase.from("reviews")
            .select().eq("user_id", value: me).execute().value
        async let progressReq: [ReadingProgress] = supabase.from("reading_progress")
            .select().eq("user_id", value: me).execute().value
        let (myReactions, myReplies, myReviews, myProgress) =
            try await (reactionsReq, repliesReq, reviewsReq, progressReq)

        let reactionById = Dictionary(uniqueKeysWithValues: myReactions.map { ($0.id, $0) })
        let replyById = Dictionary(uniqueKeysWithValues: myReplies.map { ($0.id, $0) })
        let reviewById = Dictionary(uniqueKeysWithValues: myReviews.map { ($0.id, $0) })
        let progressById = Dictionary(uniqueKeysWithValues: myProgress.map { ($0.id, $0) })
        let targetIds = Array(reactionById.keys) + Array(replyById.keys)
            + Array(reviewById.keys) + Array(progressById.keys)

        async let engsReq: [Engagement] = targetIds.isEmpty ? [] : supabase.from("engagements")
            .select()
            .in("target_id", values: targetIds.map { $0.uuidString })
            .neq("user_id", value: me)
            .order("created_at", ascending: false)
            .limit(limit)
            .execute().value
        async let commentsReq: [ReactionReply] = myReactions.isEmpty ? [] : supabase.from("reaction_replies")
            .select()
            .in("reaction_id", values: myReactions.map { $0.id.uuidString })
            .neq("user_id", value: me)
            .order("created_at", ascending: false)
            .limit(limit)
            .execute().value
        let (engs, comments) = try await (engsReq, commentsReq)

        // My replies hang off OTHER people's reactions - resolve those parents
        // for their book ids (visible to me: I could see them when I replied).
        let parentIds = Set(myReplies.map(\.reactionId)).subtracting(reactionById.keys)
        let parents: [Reaction] = parentIds.isEmpty ? [] : try await supabase.from("reactions")
            .select()
            .in("id", values: parentIds.map { $0.uuidString })
            .execute().value
        let parentById = Dictionary(uniqueKeysWithValues: parents.map { ($0.id, $0) })

        func bookId(of e: Engagement) -> UUID? {
            switch e.targetType {
            case .reaction: return reactionById[e.targetId]?.bookId
            case .reply:
                guard let rep = replyById[e.targetId] else { return nil }
                return (reactionById[rep.reactionId] ?? parentById[rep.reactionId])?.bookId
            case .review: return reviewById[e.targetId]?.bookId
            case .progress: return progressById[e.targetId]?.bookId
            default: return nil
            }
        }

        let bookIds = Set(engs.compactMap(bookId(of:))
            + comments.compactMap { reactionById[$0.reactionId]?.bookId })
        let books: [Book] = bookIds.isEmpty ? [] : try await supabase.from("books")
            .select()
            .in("id", values: bookIds.map { $0.uuidString })
            .execute().value
        let bookById = Dictionary(uniqueKeysWithValues: books.map { ($0.id, $0) })

        let actorIds = Set(engs.map(\.userId) + comments.map(\.userId))
        let actorById = try await profilesById(Array(actorIds))

        var items: [ActivityItem] = []

        for e in engs {
            guard let book = bookId(of: e).flatMap({ bookById[$0] }) else { continue }
            let what: ActivityItem.What
            var snippet: String?
            switch e.targetType {
            case .reaction:
                what = .reaction
                snippet = reactionById[e.targetId]?.body
            case .reply:
                what = .comment
                snippet = replyById[e.targetId]?.body
            case .review:
                what = .review
                snippet = reviewById[e.targetId]?.body
            case .progress:
                what = .progress
            default: continue
            }
            items.append(ActivityItem(
                id: e.id,
                kind: e.kind == EngagementKind.like ? .like : .emoji(e.kind),
                actor: actorById[e.userId],
                what: what, snippet: snippet, body: nil,
                book: book, at: e.createdAt
            ))
        }

        for c in comments {
            guard let parent = reactionById[c.reactionId],
                  let book = bookById[parent.bookId] else { continue }
            items.append(ActivityItem(
                id: c.id, kind: .reply,
                actor: actorById[c.userId],
                what: .reaction, snippet: parent.body, body: c.body,
                book: book, at: c.createdAt
            ))
        }

        items.sort { $0.at > $1.at }
        if items.count > limit { items = Array(items.prefix(limit)) }
        return items
    }
}
