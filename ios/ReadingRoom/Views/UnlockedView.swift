// The per-book "Unlocked" list the post-bump banner pushes from BookView. The
// feed's ✨ Unlocked tab is the primary surface (FeedView); this view exists so
// "View →" right after a bump lands on JUST the reactions that book unlocked.
// It renders the SAME FeedEventCard as the feed, with its own engagement
// context, so the format matches everywhere. Everything is RLS-gated upstream
// (API.myUnlocks re-joins reactions under the reader's own policy).

import SwiftUI

// The moment-of-unlock banner shown atop BookView after a bump that opened ≥1
// reaction. "View →" pushes this book's unlocked list; × dismisses.
struct UnlockBanner: View {
    let count: Int
    let bookId: UUID
    let onDismiss: () -> Void

    private var label: String {
        count == 1 ? "1 reaction unlocked" : "\(count) reactions unlocked"
    }

    var body: some View {
        HStack(spacing: 10) {
            Text("✨ \(label) while you were away.")
                .font(Theme.monoFont(13))
                .foregroundStyle(Theme.textPrimary)
            Spacer(minLength: 8)
            NavigationLink(value: Route.unlocked(bookId: bookId)) {
                Text("View →")
                    .font(Theme.monoMedium(13))
                    .foregroundStyle(Theme.yarnOchre)
            }
            .simultaneousGesture(TapGesture().onEnded { onDismiss() })
            Button(action: onDismiss) {
                Image(systemName: "xmark").font(.system(size: 11, weight: .bold))
            }
            .foregroundStyle(Theme.textMuted)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Theme.surface2)
        .overlay(Rectangle().frame(height: 2).foregroundStyle(Theme.yarnOchre), alignment: .bottom)
    }
}

struct UnlockedView: View {
    let bookId: UUID?   // nil = all books (legacy deep-link); a book = filtered

    @State private var events: [FeedEvent] = []
    @State private var context: EngageContext = .empty
    @State private var loading = true
    @State private var loadError: String?

    var body: some View {
        Group {
            if loading {
                ProgressView().tint(Theme.yarnSage)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let loadError {
                ScrollView { LoadErrorView(message: loadError) { await load() }.padding(16) }
            } else if events.isEmpty {
                EmptyStateView(
                    title: "you're all caught up.",
                    hint: "reactions club-mates left in pages you've read appear here once you log progress past them."
                )
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 20) {
                        ForEach(events) { event in
                            FeedEventCard(event: event, context: context) { await load() }
                        }
                    }
                    .padding(16)
                }
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle("Unlocked")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        loadError = nil
        do {
            var unlocks = try await API.myUnlocks()
            if let bookId { unlocks = unlocks.filter { $0.book.id == bookId } }

            // Same decoration the feed does: replies + engagements for these
            // reactions, so the cards carry live bars/threads (same RLS).
            let reactionIds = unlocks.map(\.reaction.id)
            async let repliesReq = API.reactionReplies(reactionIds: reactionIds)
            async let myIdReq = API.currentUserId()
            let (replies, myId) = try await (repliesReq, myIdReq)
            let engagements = try await API.engagementsFor(
                targetIds: reactionIds + replies.map(\.id))

            var profiles: [UUID: Profile] = [:]
            for u in unlocks where u.profile != nil { profiles[u.reaction.userId] = u.profile }
            for r in replies where r.profile != nil { profiles[r.reply.userId] = r.profile }

            context = EngageContext(myId: myId, engagements: engagements,
                                    replies: replies, profiles: profiles)
            events = unlocks
                .sorted {
                    $0.unlock.unlockedAt != $1.unlock.unlockedAt
                        ? $0.unlock.unlockedAt > $1.unlock.unlockedAt
                        : $0.reaction.page < $1.reaction.page
                }
                .map { u in
                    FeedEvent(id: "unlock-\(u.reaction.id)", ts: u.unlock.unlockedAt,
                              kind: .reaction(ReactionItem(reaction: u.reaction, profile: u.profile)),
                              eventType: .reaction,
                              club: "✨ Unlocked",   // the card's header chip
                              bookTitle: u.book.title,
                              go: .book(clubId: u.book.clubId, bookId: u.book.id))
                }
            loading = false
            // Viewing marks the shown rows seen (server-side, cross-device).
            let unseen = unlocks.filter { $0.unlock.seenAt == nil }.map(\.reaction.id)
            if !unseen.isEmpty { try? await API.markUnlocksSeen(unseen) }
        } catch {
            loadError = error.localizedDescription
            loading = false
        }
    }
}
