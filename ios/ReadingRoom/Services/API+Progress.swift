// Reading progress (port of the PROGRESS section of src/api.js).

import Foundation
import Supabase

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

    // Upsert my progress row; stamps started_at / finished_at like the web.
    @discardableResult
    static func setProgress(bookId: UUID, currentPage: Int, status: ProgressStatus) async throws -> ReadingProgress {
        let uid = try await currentUserId()
        let now = Date()
        var row = ProgressUpsert(bookId: bookId, userId: uid,
                                 currentPage: currentPage, status: status,
                                 updatedAt: now)
        if status == .reading { row.startedAt = now }
        if status == .finished { row.finishedAt = now }
        return try await supabase.from("reading_progress")
            .upsert(row, onConflict: "book_id,user_id")
            .select()
            .single()
            .execute().value
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
    }

    // My personal reading history: every book I've marked finished, across all
    // my clubs, newest first - with my own rating if I reviewed it. RLS still
    // applies (only books in clubs I belong to, only my progress/reviews).
    static func myReadingHistory() async throws -> [HistoryBook] {
        let uid = try await currentUserId()
        let progress: [ReadingProgress] = try await supabase.from("reading_progress")
            .select()
            .eq("user_id", value: uid.uuidString)
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
            .eq("user_id", value: uid.uuidString)
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
}
