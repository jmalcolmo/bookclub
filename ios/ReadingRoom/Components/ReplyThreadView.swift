// The collapsible reply thread under a reaction (port of the thread half of
// src/engage.js): a toggle showing the count, the replies with their own small
// engagement bars, and a composer. Expansion survives reloads because SwiftUI
// keeps @State per stable ForEach identity (the reaction id).

import SwiftUI

struct ReplyThreadView: View {
    let reactionId: UUID
    let context: EngageContext
    let onChange: () async -> Void

    @Environment(ToastCenter.self) private var toasts
    @State private var isOpen = false
    @State private var draft = ""
    @State private var sending = false

    private var replies: [ReplyItem] { context.replies(for: reactionId) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.snappy) { isOpen.toggle() }
            } label: {
                Text("\u{1F4AC} \(label)")
                    .font(Theme.monoFont(12))
                    .foregroundStyle(Theme.textMuted)
            }
            .buttonStyle(.plain)

            if isOpen {
                ForEach(replies) { item in
                    ReplyRow(item: item, context: context, onChange: onChange)
                }
                composer
            }
        }
    }

    private var label: String {
        let count = replies.count
        if count == 0 { return "reply" }
        return "\(count) repl\(count == 1 ? "y" : "ies")"
    }

    private var composer: some View {
        HStack(spacing: 8) {
            TextField("write a reply\u{2026}", text: $draft, axis: .vertical)
                .font(Theme.displayFont(15))
                .textFieldStyle(.plain)
                .lineLimit(1...3)
                .padding(.vertical, 6)
                .padding(.horizontal, 10)
                .background(RoundedRectangle(cornerRadius: 6).fill(Theme.surface2))
            Button("reply") {
                sendReply()
            }
            .buttonStyle(.ghostSmall)
            .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    private func sendReply() {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !sending else { return }
        sending = true
        Task {
            defer { sending = false }
            do {
                try await API.addReply(reactionId: reactionId, body: body)
                draft = ""
                await onChange()
            } catch {
                toasts.error(error)
            }
        }
    }

}

// One reply row. Author gets edit (pencil) + delete (x). Tapping edit swaps the
// body for an inline field; save patches it (author-only per RLS), cancel restores.
private struct ReplyRow: View {
    let item: ReplyItem
    let context: EngageContext
    let onChange: () async -> Void

    @Environment(ToastCenter.self) private var toasts
    @State private var editing = false
    @State private var draft = ""
    @State private var saving = false

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            AvatarView(profile: item.profile, size: 22)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(item.profile?.displayName ?? "Reader")
                        .font(Theme.monoMedium(12))
                        .foregroundStyle(Theme.textPrimary)
                    Text(Format.timeAgo(item.reply.createdAt))
                        .font(Theme.monoFont(11))
                        .foregroundStyle(Theme.textMuted)
                    Spacer()
                    if item.reply.userId == context.myId {
                        Button {
                            draft = item.reply.body
                            editing = true
                        } label: {
                            Image(systemName: "pencil")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(Theme.textMuted)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Edit reply")
                        Button {
                            deleteReply(item.id)
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(Theme.textMuted)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Delete reply")
                    }
                }
                if editing {
                    HStack(spacing: 8) {
                        TextField("edit reply\u{2026}", text: $draft, axis: .vertical)
                            .font(Theme.displayFont(15))
                            .textFieldStyle(.plain)
                            .lineLimit(1...3)
                            .padding(.vertical, 6)
                            .padding(.horizontal, 10)
                            .background(RoundedRectangle(cornerRadius: 6).fill(Theme.surface2))
                        Button("save") { saveEdit() }
                            .buttonStyle(.ghostSmall)
                            .disabled(saving || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        Button("cancel") { editing = false }
                            .buttonStyle(.ghostSmall)
                    }
                } else {
                    Text(item.reply.body)
                        .font(Theme.displayFont(15))
                        .foregroundStyle(Theme.textPrimary)
                }
                EngagementBar(targetType: .reply,
                              targetId: item.id,
                              context: context,
                              compact: true,
                              onChange: onChange)
            }
        }
        .padding(.leading, 4)
    }

    private func saveEdit() {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !saving else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                try await API.updateReply(item.id, body: body)
                editing = false
                await onChange()
            } catch {
                toasts.error(error)
            }
        }
    }

    private func deleteReply(_ id: UUID) {
        Task {
            do {
                try await API.deleteReply(id)
                await onChange()
            } catch {
                toasts.error(error)
            }
        }
    }
}
