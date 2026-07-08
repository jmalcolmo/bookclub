// Personal involvement view (port of views/bookInvolvement.js), keyed by
// ownerId + bookId: ONE reader's own footprint on a single book - the reactions
// they wrote, the replies they wrote, and their reading-progress events - NOT
// the whole club's feed. Reached by tapping a book on a profile's shelf.
//
// SPOILER GATE stays entirely server-side: every row arrives through RLS
// (API.userBookInvolvement), so whatever renders here is already safe to show -
// this view never re-implements gating. A "Show complete reactions" button is
// offered ONLY when the viewer and owner share a club that also has this work
// (API.sharedClubsForWork); it opens the existing full book history (BookView).
// With multiple shared clubs it shows a club chooser first.

import SwiftUI
import Observation

@MainActor
@Observable
final class BookInvolvementModel {
    let ownerId: UUID
    let bookId: UUID

    var data: BookInvolvement?
    var sharedClubs: [SharedClubBook] = []
    var loading = true
    var loadError: String?

    init(ownerId: UUID, bookId: UUID) {
        self.ownerId = ownerId
        self.bookId = bookId
    }

    func load() async {
        loading = true
        do {
            let involvement = try await API.userBookInvolvement(bookId: bookId, userId: ownerId)
            data = involvement
            loadError = nil
            // Only consult sharedClubsForWork when we can correlate the same work
            // across clubs (needs an open_library_id). The button appears only if
            // it's non-empty.
            sharedClubs = (try? await API.sharedClubsForWork(
                openLibraryId: involvement.book.openLibraryId, ownerId: ownerId)) ?? []
        } catch {
            loadError = error.localizedDescription
        }
        loading = false
    }
}

struct BookInvolvementView: View {
    let ownerId: UUID
    let bookId: UUID

    @Environment(SessionStore.self) private var session

    @State private var model: BookInvolvementModel

    init(ownerId: UUID, bookId: UUID) {
        self.ownerId = ownerId
        self.bookId = bookId
        _model = State(initialValue: BookInvolvementModel(ownerId: ownerId, bookId: bookId))
    }

    private var isSelf: Bool { ownerId == session.userId }

    var body: some View {
        Group {
            if model.loading && model.data == nil {
                ProgressView().tint(Theme.yarnSage)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = model.loadError, model.data == nil {
                ScrollView {
                    LoadErrorView(message: err) { await model.load() }
                        .padding(16)
                }
            } else if let data = model.data {
                content(data)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(isSelf ? "My Reading" : "Reading")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
        .refreshable { await model.load() }
    }

    private func content(_ data: BookInvolvement) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                bookHeader(data)
                if !model.sharedClubs.isEmpty { completeCTA }
                reactionsSection(data)
                repliesSection(data)
            }
            .padding(16)
        }
    }

    private var who: String {
        isSelf ? "you" : (model.data?.owner?.displayName ?? "this reader")
    }

    // MARK: - book header + the owner's progress line

    private func bookHeader(_ data: BookInvolvement) -> some View {
        HStack(alignment: .center, spacing: 16) {
            BookCoverView(coverUrl: data.book.coverUrl, width: 72)
            VStack(alignment: .leading, spacing: 4) {
                Text(data.book.title)
                    .font(Theme.displayBold(20))
                    .foregroundStyle(Theme.textPrimary)
                if let author = data.book.author, !author.isEmpty {
                    Text(author)
                        .font(Theme.displayFont(15))
                        .foregroundStyle(Theme.textMuted)
                        .italic()
                }
                progressLine(data.progress, book: data.book)
            }
            Spacer(minLength: 0)
        }
        .patch(seed: data.book.id.uuidString)
    }

    @ViewBuilder
    private func progressLine(_ p: ReadingProgress?, book: Book) -> some View {
        let of = book.pageCount.map { " / \($0)" } ?? ""
        if let p {
            switch p.status {
            case .finished:
                HStack(spacing: 8) {
                    Text("\u{2713} Finished")
                        .font(Theme.monoMedium(12))
                        .foregroundStyle(Theme.positive)
                        .padding(.horizontal, 10).padding(.vertical, 3)
                        .background(Capsule().fill(Theme.yarnMoss.opacity(0.22)))
                        .overlay(Capsule().stroke(Theme.yarnMoss, lineWidth: 2))
                    Text("page \(p.currentPage)\(of) \u{00B7} finished \(Format.date(p.finishedAt ?? p.updatedAt))")
                        .font(Theme.monoFont(11))
                        .foregroundStyle(Theme.textMuted)
                }
                .padding(.top, 2)
            case .reading:
                Text("\u{1F4D6} reading - page \(p.currentPage)\(of) \u{00B7} updated \(Format.timeAgo(p.updatedAt))")
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
                    .padding(.top, 2)
            case .notStarted:
                Text("\u{1F516} not started yet")
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
                    .padding(.top, 2)
            }
        } else {
            Text("no logged progress for \(who) on this book.")
                .font(Theme.monoFont(11))
                .foregroundStyle(Theme.textMuted)
                .padding(.top, 2)
        }
    }

    // MARK: - "Show complete reactions"

    @ViewBuilder
    private var completeCTA: some View {
        VStack(alignment: .leading, spacing: 8) {
            if model.sharedClubs.count > 1 {
                // Several shared clubs have this work: chooser first. Each link
                // opens that club's full book history (BookView) via the stack's
                // shared app destinations.
                Text("pick a club")
                    .font(Theme.displaySemiBold(16))
                    .foregroundStyle(Theme.textPrimary)
                Text("this book lives in more than one club you share. open its full history in:")
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
                ForEach(model.sharedClubs) { shared in
                    NavigationLink(value: Route.book(clubId: shared.club.id, bookId: shared.book.id)) {
                        Text(shared.club.name)
                    }
                    .buttonStyle(.ghost)
                }
            } else if let shared = model.sharedClubs.first {
                NavigationLink(value: Route.book(clubId: shared.club.id, bookId: shared.book.id)) {
                    Text("Show complete reactions")
                }
                .buttonStyle(.primary)
                Text("opens this book's full club history - everyone's reactions.")
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - the owner's reactions + replies (their footprint only)

    @ViewBuilder
    private func reactionsSection(_ data: BookInvolvement) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Text(isSelf ? "your reactions" : "their reactions")
                    .font(Theme.displaySemiBold(17))
                    .foregroundStyle(Theme.textPrimary)
                if !data.reactions.isEmpty {
                    Text("(\(data.reactions.count))")
                        .font(Theme.monoFont(11))
                        .foregroundStyle(Theme.textMuted)
                }
            }
            if data.reactions.isEmpty {
                Text("no reactions from \(who) on this book\(isSelf ? " yet" : "").")
                    .font(Theme.displayFont(14))
                    .foregroundStyle(Theme.textMuted)
            } else {
                ForEach(data.reactions) { item in
                    reactionCard(item)
                        .patch(seed: item.id.uuidString)
                }
            }
        }
    }

    private func reactionCard(_ item: ReactionItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                AvatarView(profile: item.profile, size: 30)
                Text(item.profile?.displayName ?? "Reader")
                    .font(Theme.monoMedium(13))
                    .foregroundStyle(Theme.textPrimary)
                Text("p.\(item.reaction.page)")
                    .font(Theme.monoMedium(11))
                    .foregroundStyle(.white)
                    .padding(.vertical, 2).padding(.horizontal, 6)
                    .background(Capsule().fill(Theme.yarnSlate))
                Text(Format.timeAgo(item.reaction.createdAt))
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
                Spacer(minLength: 0)
            }
            Text(item.reaction.body)
                .font(Theme.displayFont(16))
                .foregroundStyle(Theme.textPrimary)
        }
    }

    @ViewBuilder
    private func repliesSection(_ data: BookInvolvement) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Text(isSelf ? "your replies" : "their replies")
                    .font(Theme.displaySemiBold(17))
                    .foregroundStyle(Theme.textPrimary)
                if !data.replies.isEmpty {
                    Text("(\(data.replies.count))")
                        .font(Theme.monoFont(11))
                        .foregroundStyle(Theme.textMuted)
                }
            }
            if data.replies.isEmpty {
                Text("no replies from \(who) on this book\(isSelf ? " yet" : "").")
                    .font(Theme.displayFont(14))
                    .foregroundStyle(Theme.textMuted)
            } else {
                ForEach(data.replies) { item in
                    replyCard(item)
                        .patch(accent: Theme.yarnSlate, seed: item.id.uuidString)
                }
            }
        }
    }

    private func replyCard(_ item: InvolvementReply) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("\u{21A9} on a reaction at p.\(item.parent.page): \u{201C}\(truncate(item.parent.body, 90))\u{201D}")
                .font(Theme.displayFont(13))
                .foregroundStyle(Theme.textMuted)
                .italic()
            Text(item.reply.body)
                .font(Theme.displayFont(16))
                .foregroundStyle(Theme.textPrimary)
            Text(Format.timeAgo(item.reply.createdAt))
                .font(Theme.monoFont(11))
                .foregroundStyle(Theme.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func truncate(_ s: String, _ n: Int) -> String {
        s.count > n ? String(s.prefix(n - 1)).trimmingCharacters(in: .whitespaces) + "\u{2026}" : s
    }
}
