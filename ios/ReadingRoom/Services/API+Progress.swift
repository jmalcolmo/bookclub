// Reading progress (port of the PROGRESS section of src/api.js).

import Foundation
import Supabase

// A club the viewer and a shelf's owner both belong to that also has a given
// work (matched by open_library_id), with the specific books row to open
// (API.sharedClubsForWork). Powers "Show complete reactions".
struct SharedClubBook: Identifiable, Hashable, Sendable {
    let club: Club
    let book: Book
    var id: UUID { book.id }
}

extension API {
    // Everyone's progress on a book, with profiles (powers "who's where").
    static func bookProgress(_ bookId: UUID) async throws -> [ProgressItem] {
        let rows: [ReadingProgress] = try await supabase.from("reading_progress")
            .select()
            .eq("book_id", value: bookId.uuidString)
            .execute().value
        let profiles = try await profilesById(rows.map(\.userId))
        return rows.map { ProgressItem(progress: $0, profile: profiles[$0.userId]) }
    }

    static func myProgress(bookId: UUID) async throws -> ReadingProgress? {
        let uid = try await currentUserId()
        let rows: [ReadingProgress] = try await supabase.from("reading_progress")
            .select()
            .eq("book_id", value: bookId.uuidString)
            .eq("user_id", value: uid.uuidString)
            .execute().value
        return rows.first
    }

    private struct ProgressUpsert: Encodable {
        let bookId: UUID
        let userId: UUID
        let currentPage: Int
        let status: ProgressStatus
        let updatedAt: Date
        var startedAt: Date?
        var finishedAt: Date?
    }

    // The result of a progress save: the upserted row plus any reactions the bump
    // just unlocked (empty unless this was a forward bump). Lets a caller show the
    // "N reactions unlocked" banner without a second query.
    struct ProgressSave: Sendable {
        let progress: ReadingProgress
        let unlocked: [ReactionItem]
    }

    // Upsert my progress row; stamps started_at / finished_at like the web. A
    // forward bump (currentPage > prevPage) may open the spoiler gate on other
    // members' reactions in the crossed pages; detection lives here (one place) so
    // every caller records for free, and the newly-unlocked list rides back in the
    // result so a caller can show the banner without a second fetch. Recording never
    // fails the save - a bookkeeping error just means no banner this time.
    @discardableResult
    static func setProgress(bookId: UUID, currentPage: Int, status: ProgressStatus,
                            prevPage: Int? = nil) async throws -> ProgressSave {
        let uid = try await currentUserId()
        let now = Date()
        var row = ProgressUpsert(bookId: bookId, userId: uid,
                                 currentPage: currentPage, status: status,
                                 updatedAt: now)
        if status == .reading { row.startedAt = now }
        if status == .finished { row.finishedAt = now }
        let saved: ReadingProgress = try await supabase.from("reading_progress")
            .upsert(row, onConflict: "book_id,user_id")
            .select()
            .single()
            .execute().value

        var unlocked: [ReactionItem] = []
        if let prevPage, currentPage > prevPage {
            do {
                unlocked = try await unlockedReactions(bookId: bookId,
                                                        fromPage: prevPage, toPage: currentPage)
                try await recordUnlocks(unlocked.map(\.id))
            } catch { unlocked = [] }
        }
        return ProgressSave(progress: saved, unlocked: unlocked)
    }

    // Reset my progress on a book (delete the row). RLS (progress_delete_own)
    // restricts this to the reader themself. Removing the row re-locks any
    // reactions unlocked by reading past them - the spoiler gate reads live from
    // reading_progress, so it stays correct.
    static func deleteProgress(bookId: UUID) async throws {
        let uid = try await currentUserId()
        try await supabase.from("reading_progress")
            .delete()
            .eq("book_id", value: bookId.uuidString)
            .eq("user_id", value: uid.uuidString)
            .execute()
        // Resetting re-locks this book's reactions, so my unlock rows for it are
        // stale - drop them (mirrors api.js deleteProgress).
        let rx: [IdRow] = try await supabase.from("reactions")
            .select("id")
            .eq("book_id", value: bookId.uuidString)
            .execute().value
        guard !rx.isEmpty else { return }
        try await supabase.from("reaction_unlocks")
            .delete()
            .eq("user_id", value: uid.uuidString)
            .in("reaction_id", values: rx.map { $0.id.uuidString })
            .execute()
    }

    // One reader's reading history: every book THAT reader marked finished,
    // newest first - with their rating where the viewer may see the review.
    // Powers both my own shelf and the shelf on another reader's profile (port
    // of api.js readingHistoryFor). RLS does all the gating: their progress
    // rows return only where the viewer is a co-member (progress_select_member);
    // books resolve only in clubs the viewer can see;
    // and the owner's review returns only when the VIEWER has finished that
    // book (the review gate), so a hidden rating just renders as "not rated".
    // Whatever RLS hides simply doesn't appear - an invisible reader yields [].
    static func readingHistoryFor(_ userId: UUID) async throws -> [HistoryBook] {
        let progress: [ReadingProgress] = try await supabase.from("reading_progress")
            .select()
            .eq("user_id", value: userId.uuidString)
            .eq("status", value: ProgressStatus.finished.rawValue)
            .order("finished_at", ascending: false)
            .execute().value

        let bookIds = progress.map(\.bookId)
        guard !bookIds.isEmpty else { return [] }

        async let booksReq: [Book] = supabase.from("books")
            .select()
            .in("id", values: bookIds.map { $0.uuidString })
            .execute().value
        async let reviewsReq: [Review] = supabase.from("reviews")
            .select()
            .in("book_id", values: bookIds.map { $0.uuidString })
            .eq("user_id", value: userId.uuidString)
            .execute().value

        let (books, reviews) = try await (booksReq, reviewsReq)
        let bookById = Dictionary(uniqueKeysWithValues: books.map { ($0.id, $0) })
        let reviewByBook = Dictionary(uniqueKeysWithValues: reviews.map { ($0.bookId, $0) })

        return progress.compactMap { p in
            guard let book = bookById[p.bookId] else { return nil } // deleted / hidden
            return HistoryBook(book: book,
                               myFinishedAt: p.finishedAt ?? p.updatedAt,
                               myRating: reviewByBook[p.bookId]?.rating)
        }
    }

    // My personal reading history: every book I've marked finished, across all
    // my clubs, newest first - with my own rating if I reviewed it (the self
    // case of readingHistoryFor).
    static func myReadingHistory() async throws -> [HistoryBook] {
        try await readingHistoryFor(currentUserId())
    }

    // The clubs where the VIEWER and the OWNER are both members AND this work
    // exists (matched by open_library_id across club-scoped books rows). Powers
    // the "Show complete reactions" affordance on the personal involvement view:
    // one shared club -> jump straight to that club's full book history; several
    // -> the caller shows a chooser. Empty open_library_id can't correlate the
    // same work across clubs, so returns [] (button stays hidden). RLS applies:
    // club_members and books SELECT only return rows the viewer may read.
    // Port of api.js sharedClubsForWork.
    static func sharedClubsForWork(openLibraryId: String?, ownerId: UUID) async throws -> [SharedClubBook] {
        guard let openLibraryId, !openLibraryId.isEmpty else { return [] }
        let me = try await currentUserId()

        struct ClubIdRow: Codable { let clubId: UUID }
        async let mineReq: [ClubIdRow] = supabase.from("club_members")
            .select("club_id").eq("user_id", value: me.uuidString).execute().value
        async let theirsReq: [ClubIdRow] = supabase.from("club_members")
            .select("club_id").eq("user_id", value: ownerId.uuidString).execute().value
        let (mine, theirs) = try await (mineReq, theirsReq)

        let mineSet = Set(mine.map(\.clubId))
        let sharedIds = Array(Set(theirs.map(\.clubId)).intersection(mineSet))
        guard !sharedIds.isEmpty else { return [] }

        let books: [Book] = try await supabase.from("books")
            .select()
            .in("club_id", values: sharedIds.map { $0.uuidString })
            .eq("open_library_id", value: openLibraryId)
            .execute().value
        guard !books.isEmpty else { return [] }

        let clubs: [Club] = try await supabase.from("clubs")
            .select()
            .in("id", values: Array(Set(books.map(\.clubId))).map { $0.uuidString })
            .execute().value
        let clubById = Dictionary(uniqueKeysWithValues: clubs.map { ($0.id, $0) })

        return books.compactMap { b in
            guard let club = clubById[b.clubId] else { return nil }
            return SharedClubBook(club: club, book: b)
        }
    }
}
