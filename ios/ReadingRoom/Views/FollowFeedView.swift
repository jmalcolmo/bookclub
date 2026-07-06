// "Following" (port of views/people.js): the readers you follow, each with what
// they're reading right now - the book and the page they've reached out of how
// many. Every progress row comes back already filtered by RLS (shared clubs +
// the additive follow paths); the client never re-implements gating. Tapping a
// reader opens their profile (where follow/unfollow lives).

import SwiftUI

struct FollowFeedView: View {
    @State private var readers: [FollowedReader] = []
    @State private var loading = true
    @State private var loadError: String?

    var body: some View {
        Group {
            if loading && readers.isEmpty && loadError == nil {
                ProgressView().tint(Theme.yarnSage)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = loadError, readers.isEmpty {
                ScrollView { LoadErrorView(message: err) { await load() }.padding(16) }
            } else if readers.isEmpty {
                ScrollView {
                    EmptyStateView(
                        title: "you're not following anyone yet.",
                        hint: "open a fellow reader's profile and tap Follow to see what they're reading here."
                    )
                    .padding(16)
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(readers) { reader in
                            readerRow(reader)
                        }
                    }
                    .padding(16)
                }
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle("Following")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func readerRow(_ reader: FollowedReader) -> some View {
        NavigationLink(value: Route.reader(reader.profile.id)) {
            HStack(alignment: .center, spacing: 12) {
                AvatarView(profile: reader.profile, size: 44)
                VStack(alignment: .leading, spacing: 3) {
                    Text(reader.profile.displayName)
                        .font(Theme.displaySemiBold(16))
                        .foregroundStyle(Theme.textPrimary)
                    readingLine(reader)
                }
                Spacer()
                if let progress = reader.progress {
                    Text(Format.timeAgo(progress.updatedAt))
                        .font(Theme.monoFont(11))
                        .foregroundStyle(Theme.textMuted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .patch(seed: reader.id.uuidString, padding: 14)
    }

    // "Book Title  p.211 / 416" - or "finished Book Title", or an honest shrug
    // when RLS shows us none of their reading.
    @ViewBuilder
    private func readingLine(_ reader: FollowedReader) -> some View {
        if let book = reader.book, let progress = reader.progress {
            HStack(spacing: 6) {
                Text(progress.status == .finished ? "finished \(book.title)" : book.title)
                    .font(Theme.displayFont(14))
                    .italic()
                    .foregroundStyle(Theme.yarnRust)
                    .lineLimit(1)
                if progress.status != .finished {
                    Text(pageLabel(progress, book))
                        .font(Theme.monoMedium(11))
                        .foregroundStyle(.white)
                        .padding(.vertical, 1)
                        .padding(.horizontal, 7)
                        .background(Capsule().fill(Theme.yarnSlate))
                }
            }
        } else {
            Text("no visible reading right now")
                .font(Theme.monoFont(11))
                .foregroundStyle(Theme.textMuted)
        }
    }

    private func pageLabel(_ progress: ReadingProgress, _ book: Book) -> String {
        if let count = book.pageCount { return "p.\(progress.currentPage) / \(count)" }
        return "p.\(progress.currentPage)"
    }

    private func load() async {
        do {
            readers = try await API.followingReading()
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
        loading = false
    }
}
