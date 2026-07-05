// Shared UI for engagements (likes + iMessage-style emoji tapbacks) and
// reaction reply threads - the port of src/engage.js. Both the book feed and
// the home feed compose their cards from these pieces so look + behavior stay
// identical. All DB access still goes through the API layer.
//
// Web hover tooltips (who liked/reacted) become a long-press context menu.

import SwiftUI

// The render context every card shares: engagement lookup, reply lookup, and
// a name resolver (port of buildContext/makeNameResolver).
struct EngageContext {
    let myId: UUID?
    let engagementsByTarget: [UUID: [Engagement]]
    let repliesByReaction: [UUID: [ReplyItem]]
    let names: [UUID: String]

    static let empty = EngageContext(myId: nil, engagementsByTarget: [:],
                                     repliesByReaction: [:], names: [:])

    init(myId: UUID?,
         engagementsByTarget: [UUID: [Engagement]],
         repliesByReaction: [UUID: [ReplyItem]],
         names: [UUID: String]) {
        self.myId = myId
        self.engagementsByTarget = engagementsByTarget
        self.repliesByReaction = repliesByReaction
        self.names = names
    }

    init(myId: UUID?,
         engagements: [Engagement],
         replies: [ReplyItem],
         profiles: [UUID: Profile]) {
        self.myId = myId
        self.engagementsByTarget = Dictionary(grouping: engagements, by: \.targetId)
        self.repliesByReaction = Dictionary(grouping: replies, by: \.reply.reactionId)
        self.names = profiles.mapValues(\.displayName)
    }

    func engagements(for targetId: UUID) -> [Engagement] {
        engagementsByTarget[targetId] ?? []
    }

    func replies(for reactionId: UUID) -> [ReplyItem] {
        repliesByReaction[reactionId] ?? []
    }

    func name(of userId: UUID) -> String {
        names[userId] ?? "Someone"
    }
}

// The like + emoji-tapback bar for ONE target (reaction/reply/review/book/...).
struct EngagementBar: View {
    let targetType: EngagementTarget
    let targetId: UUID
    let context: EngageContext
    var compact = false
    let onChange: () async -> Void

    @Environment(ToastCenter.self) private var toasts
    @State private var paletteOpen = false
    @State private var busy = false

    private var byKind: [String: [UUID]] {
        var out: [String: [UUID]] = [:]
        for e in context.engagements(for: targetId) {
            out[e.kind, default: []].append(e.userId)
        }
        return out
    }

    var body: some View {
        let kinds = byKind
        let likeUsers = kinds[EngagementKind.like] ?? []
        let iLiked = context.myId.map(likeUsers.contains) ?? false

        HStack(spacing: 8) {
            // Like
            Button {
                toggle(EngagementKind.like)
            } label: {
                HStack(spacing: 4) {
                    Text("\u{1F44D}")
                        .font(.system(size: compact ? 12 : 14))
                    if !compact { Text("Like").font(Theme.monoFont(12)) }
                    if !likeUsers.isEmpty {
                        Text("\(likeUsers.count)").font(Theme.monoMedium(12))
                    }
                }
                .foregroundStyle(iLiked ? Theme.yarnSage : Theme.textMuted)
            }
            .contextMenu { namesMenu(users: likeUsers, empty: "Be the first to like") }

            // Existing emoji chips (only kinds with a count)
            ForEach(EngagementKind.emojiPalette, id: \.self) { emoji in
                if let users = kinds[emoji], !users.isEmpty {
                    let mine = context.myId.map(users.contains) ?? false
                    Button {
                        toggle(emoji)
                    } label: {
                        HStack(spacing: 3) {
                            Text(emoji).font(.system(size: compact ? 12 : 14))
                            Text("\(users.count)").font(Theme.monoMedium(11))
                        }
                        .padding(.vertical, 3)
                        .padding(.horizontal, 7)
                        .background(
                            Capsule().fill(mine ? Theme.yarnSage.opacity(0.25) : Theme.surface2)
                        )
                        .overlay(
                            Capsule().stroke(mine ? Theme.yarnSage : .clear, lineWidth: 1.5)
                        )
                        .foregroundStyle(Theme.textPrimary)
                    }
                    .contextMenu { namesMenu(users: users, empty: "") }
                }
            }

            // "+" opens the full palette
            Button {
                withAnimation(.snappy) { paletteOpen.toggle() }
            } label: {
                Text("\u{FF0B}")
                    .font(Theme.monoMedium(13))
                    .foregroundStyle(Theme.textMuted)
            }
            .accessibilityLabel("Add reaction")

            if paletteOpen {
                ForEach(EngagementKind.emojiPalette, id: \.self) { emoji in
                    let mine = context.myId.map { (kinds[emoji] ?? []).contains($0) } ?? false
                    Button {
                        paletteOpen = false
                        toggle(emoji)
                    } label: {
                        Text(emoji)
                            .font(.system(size: 16))
                            .opacity(mine ? 0.5 : 1)
                    }
                }
            }

            Spacer(minLength: 0)
        }
        .disabled(busy)
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func namesMenu(users: [UUID], empty: String) -> some View {
        if users.isEmpty {
            if !empty.isEmpty { Text(empty) }
        } else {
            ForEach(users, id: \.self) { uid in
                Text(context.name(of: uid))
            }
        }
    }

    private func toggle(_ kind: String) {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await API.toggleEngagement(targetType: targetType, targetId: targetId, kind: kind)
                await onChange()
            } catch {
                toasts.error(error)
            }
        }
    }
}
