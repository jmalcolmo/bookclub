// Client-side join shapes. The web app decorates rows with their author's
// profile in api.js (reactions/replies/reviews/progress "with profile", clubs
// with member counts, the personal reading-history shelf). These structs are
// those decorated shapes, built by the service layer, never decoded directly.

import Foundation

// A club as it appears in "my clubs": the row plus my role and the member count
// (api.js myClubs attaches member_count / my_role).
struct ClubSummary: Identifiable, Hashable, Sendable {
    let club: Club
    let memberCount: Int
    let myRole: ClubRole

    var id: UUID { club.id }
}

// A roster entry: membership row + that member's profile (nil while the
// sign-up trigger lags or if RLS hides it).
struct Member: Identifiable, Hashable, Sendable {
    let membership: ClubMember
    let profile: Profile?

    var id: UUID { membership.userId }
    var userId: UUID { membership.userId }
    var role: ClubRole { membership.role }
    var displayName: String { profile?.displayName ?? "Reader" }
}

struct ReactionItem: Identifiable, Hashable, Sendable {
    let reaction: Reaction
    let profile: Profile?
    var id: UUID { reaction.id }
}

// A recorded unlock decorated with its reaction, author, and book - the shape the
// Unlocked inbox groups by book (api.js myUnlocks). Reaction/book come back
// RLS-filtered; a row whose reaction is no longer visible is dropped upstream.
struct UnlockItem: Identifiable, Hashable, Sendable {
    let unlock: ReactionUnlock
    let reaction: Reaction
    let profile: Profile?
    let book: Book
    var id: UUID { reaction.id }
}

struct ReplyItem: Identifiable, Hashable, Sendable {
    let reply: ReactionReply
    let profile: Profile?
    var id: UUID { reply.id }
}

struct ReviewItem: Identifiable, Hashable, Sendable {
    let review: Review
    let profile: Profile?
    var id: UUID { review.id }
}

// A club post decorated with its author's profile (api.js clubPosts).
struct PostItem: Identifiable, Hashable, Sendable {
    let post: ClubPost
    let profile: Profile?
    var id: UUID { post.id }
    var displayName: String { profile?.displayName ?? "Reader" }
}

struct ProgressItem: Identifiable, Hashable, Sendable {
    let progress: ReadingProgress
    let profile: Profile?
    var id: UUID { progress.id }
}

// One shelf row of my personal reading history: a finished book plus when I
// finished it and my rating, across all my clubs (api.js myReadingHistory).
struct HistoryBook: Identifiable, Hashable, Sendable {
    let book: Book
    let myFinishedAt: Date
    let myRating: Int?
    var id: UUID { book.id }
}

// One entry of the profile's Activity feed: someone liked / emoji-reacted /
// commented on my content (api.js myActivity). `book` is where it happened -
// tapping the row navigates there; `highlightReactionId` is the reaction to
// land on when the target lives in a thread.
struct ActivityItem: Identifiable, Hashable, Sendable {
    enum Kind: Hashable, Sendable { case like, emoji(String), reply }
    enum What: String, Sendable { case reaction, comment, review, progress = "progress update" }

    let id: UUID
    let kind: Kind
    let actor: Profile?
    let what: What
    let snippet: String?     // my content the actor engaged with
    let body: String?        // the comment text (kind .reply)
    let book: Book
    let at: Date

    var route: Route { .book(clubId: book.clubId, bookId: book.id) }
}

// An Open Library search hit (openlibrary.js searchBooks mapping).
struct OpenLibraryBook: Identifiable, Hashable, Sendable {
    let openLibraryId: String   // e.g. "/works/OL123W"
    let title: String
    let author: String?
    let year: Int?
    let pageCount: Int?
    let coverUrl: String?

    var id: String { openLibraryId }
}
