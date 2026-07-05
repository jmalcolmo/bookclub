// Selections + votes (port of the SELECTIONS section of src/api.js): how the
// club decides who picks the next book (wheel / vote / pick / race).

import Foundation
import Supabase

extension API {
    private struct NewSelection: Encodable {
        let clubId: UUID
        let method: SelectionMethod
        let createdBy: UUID
        let status: SelectionStatus
    }

    @discardableResult
    static func createSelection(clubId: UUID, method: SelectionMethod) async throws -> Selection {
        let uid = try await currentUserId()
        let status: SelectionStatus = method == .vote ? .open : .decided
        return try await supabase.from("selections")
            .insert(NewSelection(clubId: clubId, method: method, createdBy: uid, status: status))
            .select()
            .single()
            .execute().value
    }

    private struct DecideChanges: Encodable {
        let resultUser: UUID
        let status: SelectionStatus
        let decidedAt: Date
    }

    // Only the selection's creator (or a club owner) can finalize - enforced by
    // RLS (selections_update_owner_or_creator).
    @discardableResult
    static func decideSelection(_ selectionId: UUID, resultUserId: UUID) async throws -> Selection {
        try await supabase.from("selections")
            .update(DecideChanges(resultUser: resultUserId, status: .decided, decidedAt: Date()))
            .eq("id", value: selectionId.uuidString)
            .select()
            .single()
            .execute().value
    }

    @discardableResult
    static func openVote(clubId: UUID) async throws -> Selection {
        try await createSelection(clubId: clubId, method: .vote)
    }

    private struct VoteUpsert: Encodable {
        let selectionId: UUID
        let voterId: UUID
        let candidateId: UUID
    }

    @discardableResult
    static func castVote(selectionId: UUID, candidateId: UUID) async throws -> SelectionVote {
        let uid = try await currentUserId()
        return try await supabase.from("selection_votes")
            .upsert(VoteUpsert(selectionId: selectionId, voterId: uid, candidateId: candidateId),
                    onConflict: "selection_id,voter_id")
            .select()
            .single()
            .execute().value
    }

    static func selectionVotes(_ selectionId: UUID) async throws -> [SelectionVote] {
        try await supabase.from("selection_votes")
            .select()
            .eq("selection_id", value: selectionId.uuidString)
            .execute().value
    }

    static func openSelections(_ clubId: UUID) async throws -> [Selection] {
        try await supabase.from("selections")
            .select()
            .eq("club_id", value: clubId.uuidString)
            .eq("status", value: SelectionStatus.open.rawValue)
            .order("created_at", ascending: false)
            .execute().value
    }

    static func clubSelections(_ clubId: UUID) async throws -> [Selection] {
        try await supabase.from("selections")
            .select()
            .eq("club_id", value: clubId.uuidString)
            .order("created_at", ascending: false)
            .execute().value
    }
}
