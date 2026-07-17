// Codable model structs for every table in supabase/schema.sql, decoded with
// the shared snake_case strategy (see PostgresCoding). Property names are the
// camelCase twins of the column names; enums carry the exact DB string values.

import Foundation

// MARK: - profiles

struct Profile: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var displayName: String
    var avatarUrl: String?
    var bio: String?
    var isAdmin: Bool
    let createdAt: Date
}

// MARK: - clubs

struct Club: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var name: String
    var description: String?
    var accent: String
    let joinCode: String
    let createdBy: UUID?
    var deadlinesEnabled: Bool
    var defaultDeadlineDays: Int?
    var photoUrl: String?
    let createdAt: Date
}

// Result rows of the find_club_by_code RPC (just enough to confirm a join).
struct FoundClub: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let name: String
    let description: String?
    let accent: String
}

// MARK: - club_members

enum ClubRole: String, Codable, Sendable {
    case creator, owner, member

    var isOwnerTier: Bool { self == .creator || self == .owner }
}

struct ClubMember: Codable, Hashable, Sendable {
    let clubId: UUID
    let userId: UUID
    let role: ClubRole
    let joinedAt: Date
}

// MARK: - books

enum BookStatus: String, Codable, Sendable {
    case upcoming, current, finished
}

struct Book: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let clubId: UUID
    var title: String
    var author: String?
    var coverUrl: String?
    var openLibraryId: String?
    var pageCount: Int?
    var pickedBy: UUID?
    var status: BookStatus
    var deadline: Date?
    var deadlineExtensions: Int
    var startedAt: Date?
    var finishedAt: Date?
    let createdAt: Date
}

// MARK: - reading_progress

enum ProgressStatus: String, Codable, Sendable {
    case notStarted = "not_started"
    case reading
    case finished
}

struct ReadingProgress: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let bookId: UUID
    let userId: UUID
    var currentPage: Int
    var status: ProgressStatus
    var startedAt: Date?
    var finishedAt: Date?
    var updatedAt: Date
}

// MARK: - reactions (spoiler-gated by RLS; whatever decodes here is safe to show)

struct Reaction: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let bookId: UUID
    let userId: UUID
    let page: Int
    let body: String
    let createdAt: Date
}

// A per-user record that a reaction became visible via a progress bump.
// seenAt == nil means it's still unseen (drives the badge). Owner-only under RLS.
struct ReactionUnlock: Codable, Hashable, Sendable {
    let userId: UUID
    let reactionId: UUID
    let unlockedAt: Date
    var seenAt: Date?
}

// MARK: - reviews

struct Review: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let bookId: UUID
    let userId: UUID
    var rating: Int?
    var body: String?
    let createdAt: Date
}

// MARK: - reaction_replies

struct ReactionReply: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let reactionId: UUID
    let userId: UUID
    let body: String
    let createdAt: Date
}

// MARK: - club_posts (lightweight, NON-spoiler-gated, member-scoped)

// A short text update OR a single photo shared to a club. NOT a review, no page
// number, so NO spoiler gate - but membership-scoped by RLS (only members of the
// club can read/write). body and imageUrl are each optional; a post carries at
// least one of them (the table CHECK enforces it).
struct ClubPost: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let clubId: UUID
    let userId: UUID
    var body: String?
    var imageUrl: String?
    let createdAt: Date
}

// MARK: - engagements (likes + emoji tapbacks, polymorphic target)

enum EngagementTarget: String, Codable, Sendable {
    case reaction, reply, review, book, progress, selection, announcement
}

struct Engagement: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let targetType: EngagementTarget
    let targetId: UUID
    let userId: UUID
    let kind: String        // "like" or a palette emoji
    let createdAt: Date
}

// The fixed tapback palette (Like is separate). Mirrors engage.js EMOJI_PALETTE
// and the DB check constraint on engagements.kind.
enum EngagementKind {
    static let like = "like"
    static let emojiPalette = ["\u{2764}\u{FE0F}", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F525}"]
}

// MARK: - announcements

struct Announcement: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let body: String
    let createdBy: UUID?
    let createdAt: Date
}

struct AnnouncementRead: Codable, Hashable, Sendable {
    let announcementId: UUID
    let userId: UUID
    let createdAt: Date
}

// MARK: - selections + votes

enum SelectionMethod: String, Codable, Sendable {
    // 'race' has no UI anymore (the marble race is a separate standalone thing)
    // but stays decodable: the DB check still allows it and historical
    // selections may carry it.
    case wheel, vote, pick, race
}

enum SelectionStatus: String, Codable, Sendable {
    case open, decided
}

struct Selection: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let clubId: UUID
    let method: SelectionMethod
    var status: SelectionStatus
    var resultUser: UUID?
    let createdBy: UUID?
    let createdAt: Date
    var decidedAt: Date?
}

struct SelectionVote: Codable, Hashable, Sendable {
    let selectionId: UUID
    let voterId: UUID
    let candidateId: UUID
    let createdAt: Date
}
