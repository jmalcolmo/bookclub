// Books (port of the BOOKS section of src/api.js).

import Foundation
import Supabase

extension API {
    static func clubBooks(_ clubId: UUID) async throws -> [Book] {
        try await supabase.from("books")
            .select()
            .eq("club_id", value: clubId.uuidString)
            .order("created_at", ascending: false)
            .execute().value
    }

    static func currentBook(_ clubId: UUID) async throws -> Book? {
        let rows: [Book] = try await supabase.from("books")
            .select()
            .eq("club_id", value: clubId.uuidString)
            .eq("status", value: BookStatus.current.rawValue)
            .order("created_at", ascending: false)
            .limit(1)
            .execute().value
        return rows.first
    }

    static func getBook(_ bookId: UUID) async throws -> Book {
        try await supabase.from("books")
            .select()
            .eq("id", value: bookId.uuidString)
            .single()
            .execute().value
    }

    struct NewBook: Encodable, Sendable {
        var clubId: UUID?
        var title: String
        var author: String?
        var coverUrl: String?
        var openLibraryId: String?
        var pageCount: Int?
        var pickedBy: UUID?
        var deadline: Date?
        var status: BookStatus = .current
    }

    @discardableResult
    static func addBook(clubId: UUID, book: NewBook) async throws -> Book {
        var payload = book
        payload.clubId = clubId
        payload.status = .current
        if payload.pickedBy == nil {
            payload.pickedBy = try await currentUserId()
        }
        return try await supabase.from("books")
            .insert(payload)
            .select()
            .single()
            .execute().value
    }

    // Partial book update. `deadline` is double-optional so the caller can
    // distinguish "leave unchanged" (nil) from "clear it" (.some(nil)) - the
    // web sends an explicit JSON null to remove a deadline.
    struct BookChanges: Encodable, Sendable {
        var title: String?
        var author: String?
        var coverUrl: String?
        var pageCount: Int?
        var status: BookStatus?
        var deadline: Date??
        var deadlineExtensions: Int?
        var finishedAt: Date?

        enum CodingKeys: String, CodingKey {
            case title, author, coverUrl, pageCount, status, deadline,
                 deadlineExtensions, finishedAt
        }

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encodeIfPresent(title, forKey: .title)
            try c.encodeIfPresent(author, forKey: .author)
            try c.encodeIfPresent(coverUrl, forKey: .coverUrl)
            try c.encodeIfPresent(pageCount, forKey: .pageCount)
            try c.encodeIfPresent(status, forKey: .status)
            if let deadline {
                // .some(date) -> the date; .some(nil) -> explicit null (removes it)
                try c.encode(deadline, forKey: .deadline)
            }
            try c.encodeIfPresent(deadlineExtensions, forKey: .deadlineExtensions)
            try c.encodeIfPresent(finishedAt, forKey: .finishedAt)
        }
    }

    @discardableResult
    static func updateBook(_ bookId: UUID, changes: BookChanges) async throws -> Book {
        try await supabase.from("books")
            .update(changes)
            .eq("id", value: bookId.uuidString)
            .select()
            .single()
            .execute().value
    }

    @discardableResult
    static func finishBook(_ bookId: UUID) async throws -> Book {
        try await updateBook(bookId, changes: BookChanges(status: .finished, finishedAt: Date()))
    }

    static func deleteBook(_ bookId: UUID) async throws {
        try await supabase.from("books")
            .delete()
            .eq("id", value: bookId.uuidString)
            .execute()
    }
}
