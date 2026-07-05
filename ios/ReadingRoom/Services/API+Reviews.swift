// Reviews (port of the REVIEWS section of src/api.js). Reviews are full
// spoilers: RLS only returns them to the author or to readers whose progress
// status is 'finished'.

import Foundation
import Supabase

extension API {
    static func bookReviews(_ bookId: UUID) async throws -> [ReviewItem] {
        let rows: [Review] = try await supabase.from("reviews")
            .select()
            .eq("book_id", value: bookId.uuidString)
            .order("created_at", ascending: false)
            .execute().value
        let profiles = try await profilesById(rows.map(\.userId))
        return rows.map { ReviewItem(review: $0, profile: profiles[$0.userId]) }
    }

    static func myReview(bookId: UUID) async throws -> Review? {
        let uid = try await currentUserId()
        let rows: [Review] = try await supabase.from("reviews")
            .select()
            .eq("book_id", value: bookId.uuidString)
            .eq("user_id", value: uid.uuidString)
            .execute().value
        return rows.first
    }

    private struct ReviewUpsert: Encodable {
        let bookId: UUID
        let userId: UUID
        let rating: Int?
        let body: String?
    }

    @discardableResult
    static func saveReview(bookId: UUID, rating: Int?, body: String?) async throws -> Review {
        let uid = try await currentUserId()
        return try await supabase.from("reviews")
            .upsert(ReviewUpsert(bookId: bookId, userId: uid, rating: rating, body: body),
                    onConflict: "book_id,user_id")
            .select()
            .single()
            .execute().value
    }
}
