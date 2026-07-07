// End-to-end service-layer test against the DEV Supabase project - the Swift
// mirror of tests/run.mjs. It signs two real DEV users in by password and
// drives the actual database through the same RLS the app relies on,
// including the spoiler gate.
//
// User A drives the app's own API layer (the code under test); user B is a
// second raw client used to probe visibility and authz from the other side,
// exactly like run.mjs's two clients.
//
// Creds come from scheme environment variables TEST_A_EMAIL / TEST_A_PASSWORD /
// TEST_B_EMAIL / TEST_B_PASSWORD (same users as .passwords/test-users.json on
// the web side). Without creds the whole suite skips. It refuses to run
// against prod.

import XCTest
import Supabase
@testable import ReadingRoom

final class ServiceLayerTests: XCTestCase {
    struct Creds {
        let aEmail: String, aPassword: String
        let bEmail: String, bPassword: String
    }

    // A real (tiny 1x1) JPEG: the buckets restrict allowed_mime_types, so the
    // test uploads genuine JPEG bytes just like the cropper output.
    static let tinyJPEG = Data(base64Encoded:
        "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////" +
        "////////////////////////////////////////////////8AAEQgAAQABAwEiAAIR" +
        "AQMRAf/EABQAAQAAAAAAAAAAAAAAAAAAAAD/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QA" +
        "FAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhED" +
        "EQA/AL+AAf/Z")!

    private static func loadCreds() -> Creds? {
        let env = ProcessInfo.processInfo.environment
        guard let ae = env["TEST_A_EMAIL"], !ae.isEmpty,
              let ap = env["TEST_A_PASSWORD"], !ap.isEmpty,
              let be = env["TEST_B_EMAIL"], !be.isEmpty,
              let bp = env["TEST_B_PASSWORD"], !bp.isEmpty else { return nil }
        return Creds(aEmail: ae, aPassword: ap, bEmail: be, bPassword: bp)
    }

    // Secondary raw client for user B (separate auth storage key so it never
    // collides with the app client's Keychain entry).
    private static func makeClientB() -> SupabaseClient {
        SupabaseClient(
            supabaseURL: AppConfig.supabaseURL,
            supabaseKey: AppConfig.supabaseAnonKey,
            options: SupabaseClientOptions(
                db: .init(encoder: PostgresCoding.encoder, decoder: PostgresCoding.decoder),
                auth: .init(storageKey: "reading-room-test-user-b")
            )
        )
    }

    func testFullActionFlow() async throws {
        guard AppConfig.isDev else {
            throw XCTSkip("Refusing to run service tests against a non-dev Supabase project.")
        }
        guard let creds = Self.loadCreds() else {
            throw XCTSkip("""
            No test users configured. Create two confirmed email/password users in the \
            DEV Supabase project and pass TEST_A_EMAIL/TEST_A_PASSWORD/TEST_B_EMAIL/\
            TEST_B_PASSWORD via the scheme (same creds as .passwords/test-users.json).
            """)
        }

        let cB = Self.makeClientB()

        // ---- sign both users in --------------------------------------------
        let sessionA = try await supabase.auth.signIn(email: creds.aEmail, password: creds.aPassword)
        let a = sessionA.user.id
        let sessionB = try await cB.auth.signIn(email: creds.bEmail, password: creds.bPassword)
        let b = sessionB.user.id

        let tag = Int(Date().timeIntervalSince1970 * 1000)

        // ---- Open Library lookup -------------------------------------------
        let hits = try await OpenLibraryAPI.searchBooks(query: "project hail mary")
        XCTAssertFalse(hits.isEmpty, "no results from Open Library")

        // ---- club lifecycle -------------------------------------------------
        let club = try await API.createClub(API.NewClub(
            name: "iOS Test Club \(tag)", description: "automated test",
            accent: "yarn-sage", deadlinesEnabled: false, defaultDeadlineDays: nil))
        XCTAssertEqual(club.joinCode.count, 6, "join code not generated")

        // Cleanup no matter how the test ends: storage objects then the club
        // (covers cascade like run.mjs).
        var avatarPath: String?
        var coverPath: String?
        defer {
            let clubId = club.id
            let paths = (avatarPath, coverPath)
            Task {
                if let p = paths.0 { try? await supabase.storage.from("avatars").remove(paths: [p]) }
                if let p = paths.1 { try? await supabase.storage.from("club-images").remove(paths: [p]) }
                try? await API.deleteClub(clubId)
            }
        }

        // creator auto-membership trigger
        let myMembership = try await API.myMembership(clubId: club.id)
        XCTAssertEqual(myMembership?.role, .creator, "creator should have role 'creator'")

        // B finds by code (RPC), cannot read the row directly pre-join
        let found: [FoundClub] = try await cB
            .rpc("find_club_by_code", params: ["_code": club.joinCode])
            .execute().value
        XCTAssertEqual(found.first?.id, club.id, "RPC did not return the club")

        let preJoin: [Club] = try await cB.from("clubs").select()
            .eq("id", value: club.id.uuidString).execute().value
        XCTAssertTrue(preJoin.isEmpty, "non-member could read club row directly")

        // PROFILE GATE: B cannot read A's profile before sharing a club
        let preProfiles: [Profile] = try await cB.from("profiles").select()
            .eq("id", value: a.uuidString).execute().value
        XCTAssertTrue(preProfiles.isEmpty, "PROFILE LEAK: non-co-member read another profile")

        // B joins WITH RETURNING (load-bearing: exercises the SELECT policy on
        // the fresh row, like the web's .select().single())
        struct NewMembership: Encodable { let clubId: UUID; let userId: UUID; let role: String }
        let joined: ClubMember = try await cB.from("club_members")
            .insert(NewMembership(clubId: club.id, userId: b, role: "member"))
            .select().single().execute().value
        XCTAssertEqual(joined.userId, b)

        let postJoin: Club = try await cB.from("clubs").select()
            .eq("id", value: club.id.uuidString).single().execute().value
        XCTAssertEqual(postJoin.id, club.id, "member cannot read club")

        let postProfiles: [Profile] = try await cB.from("profiles").select()
            .eq("id", value: a.uuidString).execute().value
        XCTAssertEqual(postProfiles.count, 1, "co-member should read a fellow member's profile")

        // MY CLUBS: a 2-member club appears exactly once (the de-dupe fix)
        let mine = try await API.myClubs()
        XCTAssertEqual(mine.filter { $0.id == club.id }.count, 1,
                       "DUPLICATE CLUB: club appeared more than once in my clubs")
        XCTAssertEqual(mine.first { $0.id == club.id }?.memberCount, 2)

        // CLUB UPDATE: creator can, member cannot
        let updated = try await API.updateClub(club.id, changes: API.ClubChanges(
            description: "renamed by creator", accent: "yarn-rust"))
        XCTAssertEqual(updated.description, "renamed by creator")

        struct Hijack: Encodable { let description: String }
        _ = try? await cB.from("clubs").update(Hijack(description: "hijacked"))
            .eq("id", value: club.id.uuidString).execute()
        let afterHijack = try await API.getClub(club.id)
        XCTAssertNotEqual(afterHijack.description, "hijacked",
                          "CLUB UPDATE LEAK: a non-creator member edited club settings")

        // ---- club posts: member-scoped, NON-spoiler-gated -------------------
        // A uploads a photo under the club folder (member-scoped storage RLS)
        // then creates a text+photo post through the app API under test.
        var postImagePath: String?
        let postUrl = try await API.uploadPostImage(clubId: club.id, jpegData: Self.tinyJPEG)
        postImagePath = String(postUrl.split(separator: "/").suffix(2).joined(separator: "/"))
        let post = try await API.addPost(clubId: club.id, body: "hello club \(tag)", imageUrl: postUrl)
        XCTAssertEqual(post.imageUrl, postUrl, "post image_url was not saved")

        // Cleanup the post photo while the club (and A's membership) still exists.
        defer {
            if let p = postImagePath {
                Task { try? await supabase.storage.from("post-images").remove(paths: [p]) }
            }
        }

        // B (co-member) reads it — NO spoiler gate, just membership.
        let bSeesPosts: [ClubPost] = try await cB.from("club_posts").select()
            .eq("club_id", value: club.id.uuidString).execute().value
        XCTAssertTrue(bSeesPosts.contains { $0.id == post.id },
                      "co-member could not read a club post")

        // A edits their own post; a non-author (B) cannot.
        let editedPost = try await API.updatePost(post.id, body: "edited post")
        XCTAssertEqual(editedPost.body, "edited post", "own post edit failed")

        struct PostHijack: Encodable { let body: String }
        _ = try? await cB.from("club_posts").update(PostHijack(body: "hijacked post"))
            .eq("id", value: post.id.uuidString).execute()
        let postAfterHijack: ClubPost = try await cB.from("club_posts").select()
            .eq("id", value: post.id.uuidString).single().execute().value
        XCTAssertEqual(postAfterHijack.body, "edited post",
                       "POST UPDATE LEAK: a non-author edited someone else's post")

        // B cannot delete A's post.
        _ = try? await cB.from("club_posts").delete().eq("id", value: post.id.uuidString).execute()
        let postStill = try await API.clubPosts(club.id)
        XCTAssertTrue(postStill.contains { $0.id == post.id },
                      "POST DELETE LEAK: a non-author deleted someone else's post")

        // Author deletes their own post through the API under test.
        try await API.deletePost(post.id)
        let afterDeletePost = try await API.clubPosts(club.id)
        XCTAssertFalse(afterDeletePost.contains { $0.id == post.id }, "own post delete failed")

        // ---- book -----------------------------------------------------------
        let book = try await API.addBook(clubId: club.id, book: API.NewBook(
            title: "iOS Test Book \(tag)", author: "Tester", pageCount: 300))
        XCTAssertEqual(book.status, .current)

        // deadline set + explicit clear (the double-optional encoding)
        let withDeadline = try await API.updateBook(book.id, changes: API.BookChanges(
            deadline: .some(Date().addingTimeInterval(7 * 86400))))
        XCTAssertNotNil(withDeadline.deadline, "deadline was not saved")
        let cleared = try await API.updateBook(book.id, changes: API.BookChanges(deadline: .some(nil)))
        XCTAssertNil(cleared.deadline, "explicit-null deadline removal failed")

        let current = try await API.currentBook(club.id)
        XCTAssertEqual(current?.id, book.id, "currentBook did not return the book")
        let books = try await API.clubBooks(club.id)
        XCTAssertTrue(books.contains { $0.id == book.id }, "clubBooks missing the book")

        // ---- progress + reactions + THE SPOILER GATE ------------------------
        _ = try await API.setProgress(bookId: book.id, currentPage: 50, status: .reading)
        let r30 = try await API.addReaction(bookId: book.id, page: 30, body: "early thought")
        let r200 = try await API.addReaction(bookId: book.id, page: 200, body: "late twist!")

        // reaction -> progress sync invariant (the app's prompt enforces this)
        let myReactions = try await API.bookReactions(book.id)
            .filter { $0.reaction.userId == a }
        let maxPage = myReactions.map(\.reaction.page).max() ?? 0
        if let mineNow = try await API.myProgress(bookId: book.id), mineNow.currentPage < maxPage {
            _ = try await API.setProgress(bookId: book.id, currentPage: maxPage, status: .reading)
        }
        let synced = try await API.myProgress(bookId: book.id)
        XCTAssertGreaterThanOrEqual(synced?.currentPage ?? 0, maxPage,
                                    "PROGRESS BEHIND REACTION")

        // B logs page 40 and must see p.30 but NOT p.200
        struct ProgressUpsert: Encodable {
            let bookId: UUID; let userId: UUID; let currentPage: Int; let status: String
        }
        _ = try await cB.from("reading_progress")
            .upsert(ProgressUpsert(bookId: book.id, userId: b, currentPage: 40, status: "reading"),
                    onConflict: "book_id,user_id").execute()
        let bSees: [Reaction] = try await cB.from("reactions").select()
            .eq("book_id", value: book.id.uuidString).execute().value
        let bPages = bSees.map(\.page)
        XCTAssertTrue(bPages.contains(30), "B should see the page-30 reaction")
        XCTAssertFalse(bPages.contains(200), "SPOILER LEAK: B saw the page-200 reaction")

        // author sees all own reactions
        let aPages = try await API.bookReactions(book.id).map(\.reaction.page)
        XCTAssertTrue(aPages.contains(30) && aPages.contains(200), "author cannot see own reactions")

        // delete own; non-author cannot delete
        let tmp = try await API.addReaction(bookId: book.id, page: 5, body: "oops, delete me")
        try await API.deleteReaction(tmp.id)
        let afterDelete = try await API.bookReactions(book.id)
        XCTAssertFalse(afterDelete.contains { $0.id == tmp.id }, "own delete failed")

        _ = try? await cB.from("reactions").delete().eq("id", value: r30.id.uuidString).execute()
        let r30Still = try await API.bookReactions(book.id)
        XCTAssertTrue(r30Still.contains { $0.id == r30.id },
                      "REACTION DELETE LEAK: non-author deleted someone else's reaction")

        // EDIT own reaction (body + page); non-author cannot
        let editedR30 = try await API.updateReaction(r30.id, page: 35, body: "edited early thought")
        XCTAssertEqual(editedR30.body, "edited early thought", "own reaction edit failed")
        XCTAssertEqual(editedR30.page, 35, "own reaction page edit failed")

        struct ReactionHijack: Encodable { let body: String }
        _ = try? await cB.from("reactions").update(ReactionHijack(body: "hijacked reaction"))
            .eq("id", value: r30.id.uuidString).execute()
        let r30AfterHijack = try await API.bookReactions(book.id).first { $0.id == r30.id }
        XCTAssertEqual(r30AfterHijack?.reaction.body, "edited early thought",
                       "REACTION UPDATE LEAK: a non-author edited someone else's reaction")

        // ---- replies inherit the gate ---------------------------------------
        struct NewReply: Encodable { let reactionId: UUID; let userId: UUID; let body: String }
        let bReply: ReactionReply = try await cB.from("reaction_replies")
            .insert(NewReply(reactionId: r30.id, userId: b, body: "ha, same"))
            .select().single().execute().value

        let visibleReplies = try await API.reactionReplies(reactionIds: [r30.id])
        XCTAssertTrue(visibleReplies.contains { $0.id == bReply.id },
                      "reaction author couldn't see a reply on it")

        // A cannot delete B's reply
        try await API.deleteReply(bReply.id)
        let replyStill: [ReactionReply] = try await cB.from("reaction_replies").select()
            .eq("id", value: bReply.id.uuidString).execute().value
        XCTAssertEqual(replyStill.count, 1, "REPLY DELETE LEAK: non-author deleted a reply")

        // EDIT own reply; non-author cannot edit someone else's
        let aReply = try await API.addReply(reactionId: r30.id, body: "my own reply")
        let editedReply = try await API.updateReply(aReply.id, body: "my edited reply")
        XCTAssertEqual(editedReply.body, "my edited reply", "own reply edit failed")

        struct ReplyHijack: Encodable { let body: String }
        _ = try? await cB.from("reaction_replies").update(ReplyHijack(body: "hijacked reply"))
            .eq("id", value: aReply.id.uuidString).execute()
        let aReplyAfter: [ReactionReply] = try await cB.from("reaction_replies").select()
            .eq("id", value: aReply.id.uuidString).execute().value
        XCTAssertEqual(aReplyAfter.first?.body, "my edited reply",
                       "REPLY UPDATE LEAK: a non-author edited someone else's reply")

        // A replies to own gated p.200 reaction; B can't see or post there
        let lateReply = try await API.addReply(reactionId: r200.id, body: "spoiler-y reply")
        let bLate: [ReactionReply] = try await cB.from("reaction_replies").select()
            .eq("id", value: lateReply.id.uuidString).execute().value
        XCTAssertTrue(bLate.isEmpty, "REPLY LEAK: B saw a reply past their progress")

        var bBlockedReply = false
        do {
            let _: ReactionReply = try await cB.from("reaction_replies")
                .insert(NewReply(reactionId: r200.id, userId: b, body: "should be blocked"))
                .select().single().execute().value
        } catch { bBlockedReply = true }
        XCTAssertTrue(bBlockedReply, "REPLY LEAK: B replied to a reaction it can't see")

        // ---- engagements inherit every gate ----------------------------------
        // toggle on -> on, toggle again -> off (the API's toggle semantics)
        let onNow = try await API.toggleEngagement(targetType: .reaction, targetId: r30.id, kind: "like")
        XCTAssertTrue(onNow, "first toggle should turn the like ON")
        let offNow = try await API.toggleEngagement(targetType: .reaction, targetId: r30.id, kind: "like")
        XCTAssertFalse(offNow, "second toggle should remove the like")

        struct NewEngagement: Encodable {
            let targetType: String; let targetId: UUID; let userId: UUID; let kind: String
        }
        // B can like the visible reaction + the book
        _ = try await cB.from("engagements")
            .insert(NewEngagement(targetType: "reaction", targetId: r30.id, userId: b, kind: "like"))
            .execute()
        _ = try await cB.from("engagements")
            .insert(NewEngagement(targetType: "book", targetId: book.id, userId: b, kind: "like"))
            .execute()
        // ...but not the gated p.200 reaction
        var bBlockedLike = false
        do {
            let _: Engagement = try await cB.from("engagements")
                .insert(NewEngagement(targetType: "reaction", targetId: r200.id, userId: b, kind: "like"))
                .select().single().execute().value
        } catch { bBlockedLike = true }
        XCTAssertTrue(bBlockedLike, "ENGAGE LEAK: B liked a reaction it can't see")

        // ---- gates open as B reads on ----------------------------------------
        _ = try await cB.from("reading_progress")
            .upsert(ProgressUpsert(bookId: book.id, userId: b, currentPage: 250, status: "reading"),
                    onConflict: "book_id,user_id").execute()
        let bSees250: [Reaction] = try await cB.from("reactions").select()
            .eq("book_id", value: book.id.uuidString).execute().value
        XCTAssertTrue(bSees250.map(\.page).contains(200), "B should see p.200 after reading past it")

        // ---- reviews unlock on finish -----------------------------------------
        _ = try await API.setProgress(bookId: book.id, currentPage: 300, status: .finished)
        _ = try await API.saveReview(bookId: book.id, rating: 4, body: "solid read")

        let history = try await API.myReadingHistory()
        XCTAssertTrue(history.contains { $0.book.id == book.id },
                      "finished book missing from myReadingHistory")
        XCTAssertEqual(history.first { $0.book.id == book.id }?.myRating, 4)

        // REVIEW GATE: B (reading, not finished) sees nothing
        let bReviewsBefore: [Review] = try await cB.from("reviews").select()
            .eq("book_id", value: book.id.uuidString).execute().value
        XCTAssertTrue(bReviewsBefore.isEmpty, "REVIEW LEAK: B saw a review before finishing")

        struct FinishUpsert: Encodable {
            let bookId: UUID; let userId: UUID; let currentPage: Int; let status: String
        }
        _ = try await cB.from("reading_progress")
            .upsert(FinishUpsert(bookId: book.id, userId: b, currentPage: 300, status: "finished"),
                    onConflict: "book_id,user_id").execute()
        let bReviewsAfter: [Review] = try await cB.from("reviews").select()
            .eq("book_id", value: book.id.uuidString).execute().value
        XCTAssertGreaterThanOrEqual(bReviewsAfter.count, 1, "B should see reviews after finishing")

        // REVIEW DELETE: non-author cannot delete A's review; author can
        let aReview = try await API.myReview(bookId: book.id)
        XCTAssertNotNil(aReview, "A's review missing before delete test")
        if let rev = aReview {
            _ = try? await cB.from("reviews").delete().eq("id", value: rev.id.uuidString).execute()
            let stillThere = try await API.myReview(bookId: book.id)
            XCTAssertNotNil(stillThere, "REVIEW DELETE LEAK: a non-author deleted someone else's review")
            try await API.deleteReview(rev.id)
            let afterOwnDelete = try await API.myReview(bookId: book.id)
            XCTAssertNil(afterOwnDelete, "own review delete failed")
            // restore for downstream history assertions that expect the rating
            _ = try await API.saveReview(bookId: book.id, rating: 4, body: "solid read")
        }

        // reply gate opened too
        let bLateNow: [ReactionReply] = try await cB.from("reaction_replies").select()
            .eq("id", value: lateReply.id.uuidString).execute().value
        XCTAssertEqual(bLateNow.count, 1, "B should see the p.200 reply once read past it")

        // ---- selections: wheel result, vote flow, authz ------------------------
        let wheelSel = try await API.createSelection(clubId: club.id, method: .wheel)
        let decided = try await API.decideSelection(wheelSel.id, resultUserId: b)
        XCTAssertEqual(decided.resultUser, b, "selection result not stored")

        let vote = try await API.openVote(clubId: club.id)
        _ = try await API.castVote(selectionId: vote.id, candidateId: b)
        struct VoteUpsert: Encodable { let selectionId: UUID; let voterId: UUID; let candidateId: UUID }
        _ = try await cB.from("selection_votes")
            .upsert(VoteUpsert(selectionId: vote.id, voterId: b, candidateId: b),
                    onConflict: "selection_id,voter_id").execute()
        let votes = try await API.selectionVotes(vote.id)
        XCTAssertEqual(votes.count, 2, "expected 2 votes")
        _ = try await API.decideSelection(vote.id, resultUserId: b)

        // SELECTION GATE: B (not creator) cannot finalize A's open selection
        let sel2 = try await API.createSelection(clubId: club.id, method: .vote)
        struct Crown: Encodable { let status: String; let resultUser: UUID }
        _ = try? await cB.from("selections").update(Crown(status: "decided", resultUser: b))
            .eq("id", value: sel2.id.uuidString).execute()
        let sel2Now = try await API.clubSelections(club.id).first { $0.id == sel2.id }
        XCTAssertEqual(sel2Now?.status, .open,
                       "SELECTION LEAK: a non-creator crowned the winner")
        XCTAssertNil(sel2Now?.resultUser)

        // BOOK GATE: B cannot finish the book for the club; A can
        struct FinishBook: Encodable { let status: String }
        _ = try? await cB.from("books").update(FinishBook(status: "finished"))
            .eq("id", value: book.id.uuidString).execute()
        let bookAfterHijack = try await API.getBook(book.id)
        XCTAssertNotEqual(bookAfterHijack.status, .finished,
                          "BOOK GATE LEAK: a non-creator finished the club's book")
        _ = try await API.finishBook(book.id)
        let finishedBooks = try await API.clubBooks(club.id).filter { $0.status == .finished }
        XCTAssertTrue(finishedBooks.contains { $0.id == book.id }, "finished book not in history")

        // ---- profile update -----------------------------------------------------
        let renamed = try await API.updateProfile(a, changes: API.ProfileChanges(
            displayName: "iOS Tester A \(tag)"))
        XCTAssertEqual(renamed.displayName, "iOS Tester A \(tag)")

        // ---- storage: paths + folder scoping ------------------------------------
        let avatarUrl = try await API.uploadAvatar(jpegData: Self.tinyJPEG)
        avatarPath = String(avatarUrl.split(separator: "/").suffix(2).joined(separator: "/"))
        let withAvatar = try await API.updateProfile(a, changes: API.ProfileChanges(avatarUrl: avatarUrl))
        XCTAssertEqual(withAvatar.avatarUrl, avatarUrl, "avatar_url was not saved")

        // AVATAR GATE: A cannot write into B's folder
        var avatarBlocked = false
        do {
            try await supabase.storage.from("avatars")
                .upload("\(b.uuidString.lowercased())/\(tag).jpg", data: Self.tinyJPEG,
                        options: FileOptions(contentType: "image/jpeg", upsert: false))
        } catch { avatarBlocked = true }
        XCTAssertTrue(avatarBlocked, "AVATAR LEAK: wrote into someone else's folder")

        // CLUB ICON: creator uploads; member cannot
        let coverUrl = try await API.uploadClubImage(clubId: club.id, jpegData: Self.tinyJPEG)
        coverPath = String(coverUrl.split(separator: "/").suffix(2).joined(separator: "/"))
        let withCover = try await API.updateClub(club.id, changes: API.ClubChanges(photoUrl: coverUrl))
        XCTAssertEqual(withCover.photoUrl, coverUrl, "photo_url was not saved")

        var coverBlocked = false
        do {
            try await cB.storage.from("club-images")
                .upload("\(club.id.uuidString.lowercased())/evil-\(tag).jpg", data: Self.tinyJPEG,
                        options: FileOptions(contentType: "image/jpeg", upsert: false))
        } catch { coverBlocked = true }
        XCTAssertTrue(coverBlocked, "CLUB ICON LEAK: a non-creator uploaded the club's cover")

        // ---- deletion gates ------------------------------------------------------
        _ = try? await cB.from("clubs").delete().eq("id", value: club.id.uuidString).execute()
        let clubStill = try await API.getClub(club.id)
        XCTAssertEqual(clubStill.id, club.id, "DELETE LEAK: a non-creator deleted the club")

        let book2 = try await API.addBook(clubId: club.id, book: API.NewBook(
            title: "Throwaway \(tag)", author: "x", pageCount: 10))
        _ = try? await cB.from("books").delete().eq("id", value: book2.id.uuidString).execute()
        let booksAfterBDelete = try await API.clubBooks(club.id)
        XCTAssertTrue(booksAfterBDelete.contains { $0.id == book2.id },
                      "BOOK DELETE LEAK: a non-owner/non-picker deleted a book")
        try await API.deleteBook(book2.id)
        let booksAfterADelete = try await API.clubBooks(club.id)
        XCTAssertFalse(booksAfterADelete.contains { $0.id == book2.id },
                       "owner/picker book delete failed")

        // PROGRESS DELETE (reset): a non-owner cannot delete B's progress; the
        // owner can delete their own, which re-locks reactions past that page.
        _ = try? await supabase.from("reading_progress")
            .delete().eq("book_id", value: book.id.uuidString)
            .eq("user_id", value: b.uuidString).execute()   // A trying to wipe B's row
        let bProgressStill: [ReadingProgress] = try await cB.from("reading_progress").select()
            .eq("book_id", value: book.id.uuidString)
            .eq("user_id", value: b.uuidString).execute().value
        XCTAssertEqual(bProgressStill.count, 1,
                       "PROGRESS DELETE LEAK: a non-owner wiped another reader's progress")

        // B deletes B's OWN progress via the app API path (owner-only) and then
        // can no longer see the gated p.200 reaction (spoiler gate re-locks live).
        let bDeleteOwn: [ReadingProgress] = try await cB.from("reading_progress").delete()
            .eq("book_id", value: book.id.uuidString)
            .eq("user_id", value: b.uuidString).select().execute().value
        XCTAssertEqual(bDeleteOwn.count, 1, "owner progress delete failed")
        let bSeesAfterReset: [Reaction] = try await cB.from("reactions").select()
            .eq("book_id", value: book.id.uuidString).execute().value
        XCTAssertFalse(bSeesAfterReset.map(\.page).contains(200),
                       "SPOILER LEAK: p.200 still visible after B reset progress")

        // A resets A's own progress through the API under test (owner-only path)
        try await API.deleteProgress(bookId: book.id)
        let aProgressGone = try await API.myProgress(bookId: book.id)
        XCTAssertNil(aProgressGone, "own deleteProgress did not clear the row")

        // B leaves
        _ = try await cB.from("club_members").delete()
            .eq("club_id", value: club.id.uuidString)
            .eq("user_id", value: b.uuidString).execute()

        // ---- FOLLOWS + the SOLO follow feed (A and B now share NO club) ----------
        // B owns a private club A never joins, with a book, a reaction and progress.
        // A follows B and should see B's SOLO reading there WITHOUT joining — the
        // additive follow RLS path. Crucially this must NOT be a club-gate bypass:
        // A is not a member, and it only surfaces B's OWN authored reading.
        struct NewClubRaw: Encodable { let name: String; let accent: String; let createdBy: UUID }
        let bClub: Club = try await cB.from("clubs")
            .insert(NewClubRaw(name: "B Solo Club \(tag)", accent: "yarn-mauve", createdBy: b))
            .select().single().execute().value
        struct NewBookRaw: Encodable { let clubId: UUID; let title: String; let pageCount: Int; let pickedBy: UUID; let status: String }
        let bBook: Book = try await cB.from("books")
            .insert(NewBookRaw(clubId: bClub.id, title: "B Solo Book \(tag)", pageCount: 400, pickedBy: b, status: "current"))
            .select().single().execute().value
        struct BProgress: Encodable { let bookId: UUID; let userId: UUID; let currentPage: Int; let status: String }
        _ = try await cB.from("reading_progress")
            .upsert(BProgress(bookId: bBook.id, userId: b, currentPage: 120, status: "reading"),
                    onConflict: "book_id,user_id").execute()
        struct BReaction: Encodable { let bookId: UUID; let userId: UUID; let page: Int; let body: String }
        let bReaction: Reaction = try await cB.from("reactions")
            .insert(BReaction(bookId: bBook.id, userId: b, page: 90, body: "solo thought \(tag)"))
            .select().single().execute().value
        struct BPost: Encodable { let clubId: UUID; let userId: UUID; let body: String }
        let bPost: ClubPost = try await cB.from("club_posts")
            .insert(BPost(clubId: bClub.id, userId: b, body: "solo post \(tag)"))
            .select().single().execute().value

        // BEFORE following: A can't read B's solo profile/reactions/progress at all.
        let preFollowProfiles: [Profile] = try await supabase.from("profiles").select()
            .eq("id", value: b.uuidString).execute().value
        XCTAssertTrue(preFollowProfiles.isEmpty, "FOLLOW LEAK: saw a non-co-member profile before following")
        let preFollowReactions: [Reaction] = try await supabase.from("reactions").select()
            .eq("book_id", value: bBook.id.uuidString).execute().value
        XCTAssertTrue(preFollowReactions.isEmpty, "FOLLOW LEAK: saw a non-member's reaction before following")

        // POST MEMBERSHIP GATE: a non-member cannot read a club's posts, and posts
        // are NOT part of the follow path.
        let preFollowPosts: [ClubPost] = try await supabase.from("club_posts").select()
            .eq("club_id", value: bClub.id.uuidString).execute().value
        XCTAssertTrue(preFollowPosts.isEmpty, "POST LEAK: a non-member read a club's posts")
        _ = bPost // referenced below via the post-follow assertion
        let preFeed = try await API.followFeed()
        XCTAssertFalse(preFeed.items.contains { $0.id == bReaction.id },
                       "FOLLOW LEAK: B's reaction showed in the feed before A followed")

        // A follows B (the app API under test), then the follow paths open up.
        _ = try await API.follow(b)
        let isFollowing = try await API.isFollowing(b)
        XCTAssertTrue(isFollowing, "follow did not register")
        let following = try await API.following()
        XCTAssertTrue(following.contains(b), "following() missing the followee")
        let followingProfiles = try await API.followingProfiles()
        XCTAssertTrue(followingProfiles.contains { $0.id == b },
                      "followingProfiles() missing the followee's profile")

        // Now A sees B's SOLO reaction + progress via the additive path.
        let postFollowReactions: [Reaction] = try await supabase.from("reactions").select()
            .eq("book_id", value: bBook.id.uuidString).execute().value
        XCTAssertTrue(postFollowReactions.contains { $0.id == bReaction.id },
                      "follow path did not expose the followee's solo reaction")

        // Posts are NOT part of the follow path: following B must never expose
        // the posts of a club A isn't a member of, and A can't insert into it.
        let postFollowPosts: [ClubPost] = try await supabase.from("club_posts").select()
            .eq("club_id", value: bClub.id.uuidString).execute().value
        XCTAssertTrue(postFollowPosts.isEmpty, "POST LEAK: following exposed a non-member club's posts")
        struct IntruderPost: Encodable { let clubId: UUID; let userId: UUID; let body: String }
        var postInsertBlocked = false
        do {
            let _: ClubPost = try await supabase.from("club_posts")
                .insert(IntruderPost(clubId: bClub.id, userId: a, body: "intruder \(tag)"))
                .select().single().execute().value
        } catch { postInsertBlocked = true }
        XCTAssertTrue(postInsertBlocked, "POST LEAK: a non-member inserted a post into a club they're not in")
        let feed = try await API.followFeed()
        XCTAssertTrue(feed.followees.contains { $0.id == b }, "feed roster missing the followee")
        XCTAssertTrue(feed.items.contains { $0.kind == .reaction && $0.id == bReaction.id },
                      "follow feed missing the followee's reaction")
        XCTAssertTrue(feed.items.contains { $0.kind == .progress },
                      "follow feed missing the followee's progress")

        // Only follower A may follow FROM themselves: A can't forge B->A.
        struct ForgedFollow: Encodable { let followerId: UUID; let followeeId: UUID }
        var forgeBlocked = false
        do {
            _ = try await supabase.from("follows")
                .insert(ForgedFollow(followerId: b, followeeId: a))
                .select().single().execute()
        } catch { forgeBlocked = true }
        XCTAssertTrue(forgeBlocked, "FOLLOW LEAK: forged a follow edge on someone else's behalf")

        // A unfollows -> the solo view re-locks live (RLS reads the graph each time).
        try await API.unfollow(b)
        let stillFollowing = try await API.isFollowing(b)
        XCTAssertFalse(stillFollowing, "unfollow did not remove the edge")
        let afterUnfollow: [Reaction] = try await supabase.from("reactions").select()
            .eq("book_id", value: bBook.id.uuidString).execute().value
        XCTAssertTrue(afterUnfollow.isEmpty, "FOLLOW LEAK: solo reaction still visible after unfollowing")

        // Clean up B's solo club (cascades its book/progress/reactions).
        _ = try await cB.from("clubs").delete().eq("id", value: bClub.id.uuidString).execute()

        // ---- announcements: non-admin cannot broadcast ----------------------------
        var broadcastBlocked = false
        do { _ = try await API.postAnnouncement(body: "should be blocked \(tag)") }
        catch { broadcastBlocked = true }
        XCTAssertTrue(broadcastBlocked, "ANNOUNCEMENT LEAK: a non-admin broadcast to everyone")

        // ---- explicit cleanup (the deferred Task is only a safety net) -----------
        if let p = avatarPath { _ = try? await supabase.storage.from("avatars").remove(paths: [p]) }
        if let p = coverPath { _ = try? await supabase.storage.from("club-images").remove(paths: [p]) }
        avatarPath = nil
        coverPath = nil
        try await API.deleteClub(club.id)
        var clubGone = false
        do { _ = try await API.getClub(club.id) } catch { clubGone = true }
        XCTAssertTrue(clubGone, "creator delete did not remove the club")
    }
}
