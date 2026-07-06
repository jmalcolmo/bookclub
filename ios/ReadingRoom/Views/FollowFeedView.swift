// "People you follow" - the follow feed (port of views/people.js). A social
// screen OUTSIDE of clubs: the readers you follow and their SOLO reading
// (reactions + progress on books in clubs you're not in). Every row comes back
// already filtered by RLS's additive follow paths; the client never re-implements
// gating.

import SwiftUI

struct FollowFeedView: View {
    @State private var followees: [Profile] = []
    @State private var items: [FollowFeedItem] = []
    @State private var loading = true
    @State private var loadError: String?

    var body: some View {
        Group {
            if loading && items.isEmpty && followees.isEmpty && loadError == nil {
                ProgressView().tint(Theme.yarnSage)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = loadError, followees.isEmpty {
                ScrollView { LoadErrorView(message: err) { await load() }.padding(16) }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        followingSection
                        feedSection
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

    @ViewBuilder
    private var followingSection: some View {
        if followees.isEmpty {
            EmptyStateView(
                title: "you're not following anyone yet.",
                hint: "open a fellow reader's profile and tap Follow to see their solo reading here."
            )
        } else {
            VStack(alignment: .leading, spacing: 12) {
                StampTitle(text: "Following (\(followees.count))", small: true)
                ForEach(followees) { profile in
                    HStack(spacing: 10) {
                        NavigationLink(value: Route.reader(profile.id)) {
                            HStack(spacing: 10) {
                                AvatarView(profile: profile, size: 40)
                                Text(profile.displayName)
                                    .font(Theme.displaySemiBold(16))
                                    .foregroundStyle(Theme.textPrimary)
                            }
                        }
                        .buttonStyle(.plain)
                        Spacer()
                        Button("unfollow") { unfollow(profile.id) }
                            .buttonStyle(.ghostSmall)
                    }
                    .patch(seed: profile.id.uuidString, padding: 10)
                }
            }
        }
    }

    @ViewBuilder
    private var feedSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            StampTitle(text: "Their Solo Reading", small: true)
            if items.isEmpty {
                EmptyStateView(
                    title: "nothing to show yet.",
                    hint: "as the people you follow read on their own, their reactions and progress land here."
                )
            } else {
                ForEach(items) { item in
                    feedRow(item)
                }
            }
        }
    }

    private func feedRow(_ item: FollowFeedItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                AvatarView(profile: item.profile, size: 36)
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.profile?.displayName ?? "Reader")
                        .font(Theme.displaySemiBold(15))
                        .foregroundStyle(Theme.textPrimary)
                    Text(lineFor(item))
                        .font(Theme.monoFont(11))
                        .foregroundStyle(Theme.textMuted)
                        .multilineTextAlignment(.leading)
                }
                Spacer()
                Text(Format.timeAgo(item.at))
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
            }
            if item.kind == .reaction, let body = item.body, !body.isEmpty {
                Text(body)
                    .font(Theme.displayFont(15))
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.leading, 48)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .patch(seed: item.id.uuidString, padding: 14)
    }

    private func lineFor(_ item: FollowFeedItem) -> String {
        let title = item.book?.title ?? "a book"
        switch item.kind {
        case .reaction:
            return "reacted on p.\(item.page) of \(title)"
        case .progress:
            if item.status == .finished { return "finished \(title)" }
            return "reached p.\(item.page) of \(title)"
        }
    }

    private func unfollow(_ userId: UUID) {
        Task {
            do {
                try await API.unfollow(userId)
                await load()
            } catch {
                loadError = error.localizedDescription
            }
        }
    }

    private func load() async {
        do {
            let feed = try await API.followFeed()
            followees = feed.followees
            items = feed.items
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
        loading = false
    }
}
