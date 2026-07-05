// Clubs + memberships (port of the CLUBS section of src/api.js).

import Foundation
import Supabase

extension API {
    // Clubs I'm a member of, with member counts, in join order.
    // Must filter to MY membership rows: the RLS SELECT policy returns the full
    // roster of every club I belong to, so without this filter a club would
    // come back once per member and appear duplicated in "my clubs".
    static func myClubs() async throws -> [ClubSummary] {
        let uid = try await currentUserId()

        struct MembershipSlice: Codable { let clubId: UUID; let role: ClubRole }
        let memberships: [MembershipSlice] = try await supabase.from("club_members")
            .select("club_id, role")
            .eq("user_id", value: uid.uuidString)
            .order("joined_at")
            .execute().value

        let ids = memberships.map(\.clubId)
        guard !ids.isEmpty else { return [] }

        let clubs: [Club] = try await supabase.from("clubs")
            .select()
            .in("id", values: ids.map { $0.uuidString })
            .execute().value

        struct CountSlice: Codable { let clubId: UUID }
        let counts: [CountSlice] = try await supabase.from("club_members")
            .select("club_id")
            .in("club_id", values: ids.map { $0.uuidString })
            .execute().value

        let clubById = Dictionary(uniqueKeysWithValues: clubs.map { ($0.id, $0) })
        var countById: [UUID: Int] = [:]
        for c in counts { countById[c.clubId, default: 0] += 1 }

        return memberships.compactMap { m in
            guard let club = clubById[m.clubId] else { return nil }
            return ClubSummary(club: club,
                               memberCount: countById[m.clubId] ?? 1,
                               myRole: m.role)
        }
    }

    static func getClub(_ clubId: UUID) async throws -> Club {
        try await supabase.from("clubs")
            .select()
            .eq("id", value: clubId.uuidString)
            .single()
            .execute().value
    }

    // Uses a SECURITY DEFINER RPC so non-members can find exactly one club by
    // its code without being able to read/enumerate other clubs.
    static func findClubByCode(_ code: String) async throws -> FoundClub? {
        let rows: [FoundClub] = try await supabase
            .rpc("find_club_by_code", params: ["_code": code])
            .execute().value
        return rows.first
    }

    struct NewClub: Encodable, Sendable {
        var name: String
        var description: String?
        var accent: String
        var deadlinesEnabled: Bool
        var defaultDeadlineDays: Int?
        var createdBy: UUID?
    }

    @discardableResult
    static func createClub(_ input: NewClub) async throws -> Club {
        var payload = input
        payload.createdBy = try await currentUserId()
        return try await supabase.from("clubs")
            .insert(payload)
            .select()
            .single()
            .execute().value
    }

    struct ClubChanges: Encodable, Sendable {
        var name: String?
        var description: String?
        var accent: String?
        var deadlinesEnabled: Bool?
        var defaultDeadlineDays: Int?
        var photoUrl: String?
    }

    @discardableResult
    static func updateClub(_ clubId: UUID, changes: ClubChanges) async throws -> Club {
        try await supabase.from("clubs")
            .update(changes)
            .eq("id", value: clubId.uuidString)
            .select()
            .single()
            .execute().value
    }

    // RLS (clubs_delete_owner) only lets a creator/owner do this; the FK
    // cascades wipe the club's members, books, reactions, reviews, progress
    // and selections.
    static func deleteClub(_ clubId: UUID) async throws {
        try await supabase.from("clubs")
            .delete()
            .eq("id", value: clubId.uuidString)
            .execute()
    }

    // The current user's membership row for one club (or nil). Lets a view
    // know my role without pulling the whole roster.
    static func myMembership(clubId: UUID) async throws -> ClubMember? {
        let uid = try await currentUserId()
        let rows: [ClubMember] = try await supabase.from("club_members")
            .select()
            .eq("club_id", value: clubId.uuidString)
            .eq("user_id", value: uid.uuidString)
            .execute().value
        return rows.first
    }

    private struct NewMembership: Encodable {
        let clubId: UUID
        let userId: UUID
        let role: ClubRole
    }

    // Insert WITH RETURNING (like the web's .select().single()) - load-bearing:
    // it exercises the members_select_same_club policy on the fresh row.
    @discardableResult
    static func joinClub(_ clubId: UUID) async throws -> ClubMember {
        let uid = try await currentUserId()
        return try await supabase.from("club_members")
            .insert(NewMembership(clubId: clubId, userId: uid, role: .member))
            .select()
            .single()
            .execute().value
    }

    static func leaveClub(_ clubId: UUID) async throws {
        let uid = try await currentUserId()
        try await supabase.from("club_members")
            .delete()
            .eq("club_id", value: clubId.uuidString)
            .eq("user_id", value: uid.uuidString)
            .execute()
    }

    // Roster with profiles attached (api.js clubMembers).
    static func clubMembers(_ clubId: UUID) async throws -> [Member] {
        let members: [ClubMember] = try await supabase.from("club_members")
            .select()
            .eq("club_id", value: clubId.uuidString)
            .execute().value
        let profiles = try await profilesById(members.map(\.userId))
        return members.map { Member(membership: $0, profile: profiles[$0.userId]) }
    }
}
