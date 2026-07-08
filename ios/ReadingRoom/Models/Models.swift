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

// MARK: - follows (a directed follow edge, outside of clubs)

struct Follow: Codable, Hashable, Sendable {
    let followerId: UUID
    let followeeId: UUID
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
// number, so NO spoiler gate — but membership-scoped by RLS (only members of the
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

// MARK: - stories (ephemeral 72h personal posts — audience-scoped, NOT gated)

// A personal, self-expiring post: a single photo and/or a short caption that
// disappears 72h after creation. NOT tied to a club and NOT spoiler-gated. RLS
// (stories_select_audience) returns only UNEXPIRED stories the reader may see —
// their own, a followee's, or a club-mate's — so whatever decodes here is safe
// to show. expiresAt is server-set (createdAt + 72h). body and imageUrl are each
// optional; a story carries at least one (the table CHECK enforces it).
struct Story: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let userId: UUID
    var body: String?
    var imageUrl: String?
    let createdAt: Date
    let expiresAt: Date
}

// A private per-viewer "seen" record (story_views). Only my own rows are ever
// visible/writable (story_views_select/insert_own), so this is a personal seen
// flag, never a public view count.
struct StoryView: Codable, Hashable, Sendable {
    let storyId: UUID
    let viewerId: UUID
    let seenAt: Date
}

// One story decorated with whether I've seen it — the unit the viewer plays and
// the strip rings read (api.js activeStories attaches a per-viewer `seen`).
struct StoryItem: Identifiable, Hashable, Sendable {
    let story: Story
    var seen: Bool
    var id: UUID { story.id }
}

// Active stories grouped by author, ready for the strip + viewer (api.js
// activeStories). `allSeen` drives the dimmed vs yarn-accent ring; `isMine`
// pins my own bubble first. `stories` are oldest→newest within the group.
struct StoryGroup: Identifiable, Hashable, Sendable {
    let userId: UUID
    let profile: Profile?
    var stories: [StoryItem]
    let isMine: Bool
    var id: UUID { userId }
    var allSeen: Bool { stories.allSatisfy { $0.seen } }
    var displayName: String { profile?.displayName ?? "Reader" }
    var latest: Date { stories.last?.story.createdAt ?? .distantPast }
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
