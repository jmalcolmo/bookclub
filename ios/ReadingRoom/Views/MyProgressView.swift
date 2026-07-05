// "My Progress" tab (port of views/progress.js): my reading position on every
// current book across all my clubs. Display-only, derived entirely from
// service-layer reads; refreshes live when my progress changes elsewhere.

import SwiftUI
import Observation

struct MyProgressView: View {
    struct Row: Identifiable {
        let club: Club
        let book: Book
        let mine: ReadingProgress?
        var id: UUID { book.id }
    }

    @State private var rows: [Row] = []
    @State private var loading = true
    @State private var loadError: String?
    @State private var bag = RealtimeBag()

    var body: some View {
        Group {
            if loading && rows.isEmpty && loadError == nil {
                VStack(spacing: 10) {
                    ProgressView().tint(Theme.yarnSage)
                    Text("loading your books\u{2026}")
                        .font(Theme.displayFont(15))
                        .foregroundStyle(Theme.textMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = loadError, rows.isEmpty {
                ScrollView {
                    LoadErrorView(message: err) { await load() }
                        .padding(16)
                }
            } else if rows.isEmpty {
                ScrollView {
                    EmptyStateView(
                        title: "you're not reading anything yet.",
                        hint: "join a club and set a book - your reading progress shows up here."
                    )
                    .padding(16)
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(rows) { row in
                            card(row)
                        }
                    }
                    .padding(16)
                }
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle("My Progress")
        .task {
            await load()
            let reload: @MainActor () -> Void = {
                bag.schedule { await load() }
            }
            bag.add(await API.subscribe(channelName: "progress-tab",
                                        table: "reading_progress",
                                        onChange: reload))
        }
        .onDisappear { bag.cancelAll() }
        .refreshable { await load() }
    }

    private func card(_ row: Row) -> some View {
        let pct = ProgressMath.percent(page: row.mine?.currentPage, of: row.book.pageCount)
        return NavigationLink(value: Route.book(clubId: row.club.id, bookId: row.book.id)) {
            HStack(alignment: .top, spacing: 12) {
                BookCoverView(coverUrl: row.book.coverUrl, width: 56)
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.book.title)
                        .font(Theme.displaySemiBold(16))
                        .foregroundStyle(Theme.textPrimary)
                        .multilineTextAlignment(.leading)
                    if let author = row.book.author, !author.isEmpty {
                        Text(author)
                            .font(Theme.displayFont(13))
                            .foregroundStyle(Theme.textMuted)
                    }
                    Text(row.club.name)
                        .font(Theme.monoFont(11))
                        .foregroundStyle(Theme.textMuted)
                    YarnProgressBar(percent: pct, tint: Theme.accent(row.club.accent))
                    HStack {
                        Text(statusLabel(row))
                            .font(Theme.monoFont(11))
                            .foregroundStyle(Theme.textMuted)
                        DeadlineBadge(deadline: row.book.deadline)
                        Spacer()
                        Text("\(pct)%")
                            .font(Theme.monoMedium(13))
                            .foregroundStyle(Theme.textPrimary)
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .patch(accent: Theme.accent(row.club.accent), seed: row.book.id.uuidString, padding: 12)
    }

    private func statusLabel(_ row: Row) -> String {
        guard let mine = row.mine else { return "not started" }
        if mine.status == .finished { return "finished \u{2713}" }
        if let pages = row.book.pageCount { return "page \(mine.currentPage) / \(pages)" }
        return "page \(mine.currentPage)"
    }

    private func load() async {
        do {
            let clubs = try await API.myClubs()
            var built: [(Int, Row)] = []
            try await withThrowingTaskGroup(of: (Int, Row?).self) { group in
                for (i, summary) in clubs.enumerated() {
                    group.addTask {
                        guard let book = try await API.currentBook(summary.id) else {
                            return (i, nil)
                        }
                        let mine = try await API.myProgress(bookId: book.id)
                        return (i, Row(club: summary.club, book: book, mine: mine))
                    }
                }
                for try await (i, row) in group {
                    if let row { built.append((i, row)) }
                }
            }
            rows = built.sorted { $0.0 < $1.0 }.map(\.1)
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
        loading = false
    }
}
