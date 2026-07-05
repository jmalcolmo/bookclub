// The club's shelf of finished books, with average ratings (port of
// views/history.js).

import SwiftUI

struct HistoryView: View {
    let clubId: UUID

    struct Row: Identifiable {
        let book: Book
        let pickerName: String
        let avgRating: Double?
        let ratingCount: Int
        var id: UUID { book.id }
    }

    @State private var club: Club?
    @State private var rows: [Row] = []
    @State private var loading = true
    @State private var loadError: String?

    var body: some View {
        Group {
            if loading && rows.isEmpty && loadError == nil {
                ProgressView().tint(Theme.yarnSage)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = loadError, rows.isEmpty {
                ScrollView {
                    LoadErrorView(message: err) { await load() }
                        .padding(16)
                }
            } else if rows.isEmpty {
                ScrollView {
                    EmptyStateView(
                        title: "no finished books yet.",
                        hint: "when a book is marked finished, it lands here."
                    )
                    .padding(16)
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(rows) { row in
                            historyRow(row)
                        }
                    }
                    .padding(16)
                }
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle("Shelf - Books Read")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func historyRow(_ row: Row) -> some View {
        NavigationLink(value: Route.book(clubId: clubId, bookId: row.book.id)) {
            HStack(alignment: .top, spacing: 12) {
                BookCoverView(coverUrl: row.book.coverUrl, width: 46)
                VStack(alignment: .leading, spacing: 3) {
                    Text(row.book.title)
                        .font(Theme.displaySemiBold(16))
                        .foregroundStyle(Theme.textPrimary)
                        .multilineTextAlignment(.leading)
                    if let author = row.book.author, !author.isEmpty {
                        Text(author)
                            .font(Theme.displayFont(14))
                            .foregroundStyle(Theme.textMuted)
                    }
                    Text("picked by \(row.pickerName) \u{00B7} finished \(Format.date(row.book.finishedAt))")
                        .font(Theme.monoFont(11))
                        .foregroundStyle(Theme.textMuted)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    if let avg = row.avgRating {
                        HStack(spacing: 3) {
                            Text(String(format: "%.1f", avg))
                                .font(Theme.monoMedium(15))
                                .foregroundStyle(Theme.textPrimary)
                            Text("\u{2605}")
                                .font(Theme.displayFont(14))
                                .foregroundStyle(Theme.yarnOchre)
                        }
                        Text("\(row.ratingCount)")
                            .font(Theme.monoFont(11))
                            .foregroundStyle(Theme.textMuted)
                    } else {
                        Text("no ratings")
                            .font(Theme.monoFont(11))
                            .foregroundStyle(Theme.textMuted)
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .patch(seed: row.book.id.uuidString, padding: 12)
    }

    private func load() async {
        do {
            async let clubReq = API.getClub(clubId)
            async let booksReq = API.clubBooks(clubId)
            async let membersReq = API.clubMembers(clubId)
            let (club, books, members) = try await (clubReq, booksReq, membersReq)
            self.club = club

            let nameById = Dictionary(uniqueKeysWithValues: members.map { ($0.userId, $0.displayName) })
            let finished = books.filter { $0.status == .finished }

            // Review averages per finished book (RLS returns only reviews I may
            // see; a book I haven't finished simply shows "no ratings").
            var built: [Row] = []
            await withTaskGroup(of: (UUID, Double?, Int).self) { group in
                for book in finished {
                    group.addTask {
                        let reviews = (try? await API.bookReviews(book.id)) ?? []
                        let rated = reviews.compactMap { $0.review.rating }
                        guard !rated.isEmpty else { return (book.id, nil, 0) }
                        let avg = Double(rated.reduce(0, +)) / Double(rated.count)
                        return (book.id, avg, rated.count)
                    }
                }
                var ratings: [UUID: (Double?, Int)] = [:]
                for await (id, avg, count) in group { ratings[id] = (avg, count) }
                built = finished.map { book in
                    let r = ratings[book.id] ?? (nil, 0)
                    let pickerName = book.pickedBy.flatMap { nameById[$0] } ?? "\u{2014}"
                    return Row(book: book, pickerName: pickerName,
                               avgRating: r.0, ratingCount: r.1)
                }
            }
            rows = built
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
        loading = false
    }
}
