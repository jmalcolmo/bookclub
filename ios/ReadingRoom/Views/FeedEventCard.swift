// The feed's event card, extracted so every surface that shows feed events -
// the mixed Feed tab, the ✨ Unlocked tab, and the per-book unlocked list the
// post-bump banner pushes - renders the SAME component (web parity:
// feed.js eventCardHTML). Engagement bars + reply threads ride on the passed
// EngageContext, so a card is fully live wherever it appears.

import SwiftUI

struct FeedEventCard: View {
    let event: FeedEvent
    let context: EngageContext
    let reload: () async -> Void

    var body: some View {
        switch event.kind {
        case .reaction(let item):
            reactionCard(item: item)
        case .notif(let icon, let text, let highlight):
            notifCard(icon: icon, text: text, highlight: highlight)
        }
    }

    // The yarn accent each event type wears (web parity: feed-kind-* colors).
    private func accent(highlight: Bool = false) -> Color {
        if highlight { return Theme.yarnOchre }
        switch event.eventType {
        case .progress: return Theme.yarnSage
        case .reaction: return Theme.yarnSlate
        case .milestone: return Theme.yarnRust
        case .pick: return Theme.yarnOchre
        case .social: return Theme.yarnClay
        }
    }

    // The small header every card carries: which club this happened in, with
    // the book it's about right underneath.
    private var cardHead: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(event.club ?? "")
                    .font(Theme.monoFont(10))
                    .kerning(1.2)
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.yarnBark)
                    .lineLimit(1)
                    .padding(.vertical, 2)
                    .padding(.horizontal, 9)
                    .background(
                        Capsule().fill(Theme.yarnBark.opacity(0.10)))
                    .overlay(
                        Capsule().stroke(Theme.yarnBark.opacity(0.45),
                                         lineWidth: 1.5))
                Spacer()
                Text(Format.timeAgo(event.ts))
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
            }
            bookLine
        }
    }

    // The book a card is about - its own line, out of the sentence.
    @ViewBuilder
    private var bookLine: some View {
        if let title = event.bookTitle {
            Text(title)
                .font(Theme.displayFont(14).italic())
                .foregroundStyle(Theme.yarnRust)
                .lineLimit(1)
        }
    }

    private func reactionCard(item: ReactionItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            cardHead
            // The author chip links to their profile; the body still links to
            // the book. Two separate links, so
            // the header sits OUTSIDE the card-level navigable.
            HStack(spacing: 8) {
                ReaderLink(userId: item.reaction.userId) {
                    HStack(spacing: 8) {
                        AvatarView(profile: item.profile, size: 30)
                        Text(item.profile?.displayName ?? "Reader")
                            .font(Theme.monoMedium(13))
                            .foregroundStyle(Theme.textPrimary)
                    }
                }
                Spacer()
                pageTag(item.reaction.page)
            }
            navigable(event.go) {
                Text(item.reaction.body)
                    .font(Theme.displayFont(16))
                    .foregroundStyle(Theme.textPrimary)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            EngagementBar(targetType: .reaction, targetId: item.id, context: context) {
                await reload()
            }
            ReplyThreadView(reactionId: item.id, context: context) {
                await reload()
            }
        }
        .patch(accent: accent(), seed: event.id)
    }

    private func notifCard(icon: String, text: String, highlight: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            cardHead
            navigable(event.go) {
                HStack(alignment: .top, spacing: 10) {
                    Text(icon).font(.system(size: 18))
                    VStack(alignment: .leading, spacing: 4) {
                        // Read updates read like little log entries (mono), the
                        // rest keep the display face; milestones sit bolder.
                        Text(text)
                            .font(event.eventType == .progress
                                  ? Theme.monoFont(13)
                                  : event.eventType == .milestone || event.eventType == .pick
                                    ? Theme.displaySemiBold(15)
                                    : Theme.displayFont(15))
                            .foregroundStyle(event.eventType == .social ? Theme.textMuted : Theme.textPrimary)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 0)
                }
            }
            if let type = event.targetType, let id = event.targetId {
                EngagementBar(targetType: type, targetId: id, context: context) {
                    await reload()
                }
            }
        }
        .patch(accent: accent(highlight: highlight), seed: event.id, padding: 12)
    }

    // Wrap content in a NavigationLink when the card has somewhere to go.
    @ViewBuilder
    private func navigable<Content: View>(_ route: Route?, @ViewBuilder content: () -> Content) -> some View {
        if let route {
            NavigationLink(value: route) { content() }
                .buttonStyle(.plain)
        } else {
            content()
        }
    }

    private func pageTag(_ page: Int) -> some View {
        Text("p.\(page)")
            .font(Theme.monoMedium(11))
            .foregroundStyle(.white)
            .padding(.vertical, 2)
            .padding(.horizontal, 6)
            .background(Capsule().fill(Theme.yarnSlate))
    }
}
