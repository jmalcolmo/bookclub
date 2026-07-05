// Small shared reading-progress pieces: the yarn progress bar, the deadline
// badge, the status label, and the shared percent math (ports of the
// .progress-bar / .deadline-badge patterns used across screens).

import SwiftUI

enum ProgressMath {
    // Percent of a book read, clamped to 0-100 (same math as the web views).
    static func percent(page: Int?, of pageCount: Int?) -> Int {
        guard let page, let pageCount, pageCount > 0 else { return 0 }
        return min(100, Int((Double(page) / Double(pageCount) * 100).rounded()))
    }

    // "finished (checkmark)" / "p.120 / 300" / "not started" status label.
    static func statusLabel(progress: ReadingProgress?, pageCount: Int?) -> String {
        guard let progress else { return "not started" }
        switch progress.status {
        case .finished:
            return "finished \u{2713}"
        case .reading:
            if let pageCount { return "p.\(progress.currentPage) / \(pageCount)" }
            return "p.\(progress.currentPage)"
        case .notStarted:
            return "not started"
        }
    }
}

struct YarnProgressBar: View {
    let percent: Int
    var tint: Color = Theme.yarnSage

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.surface2)
                Capsule()
                    .fill(tint)
                    .frame(width: max(0, geo.size.width * CGFloat(percent) / 100))
            }
        }
        .frame(height: 8)
        .overlay(Capsule().stroke(Theme.shadowInk.opacity(0.2), lineWidth: 1))
        .accessibilityElement()
        .accessibilityLabel("Progress")
        .accessibilityValue("\(percent) percent")
    }
}

// "3d left" / "2d overdue" chip; amber when close, red when past.
struct DeadlineBadge: View {
    let deadline: Date?

    var body: some View {
        if let deadline, let days = Format.daysUntil(deadline) {
            Text(days < 0 ? "\(-days)d overdue" : "\(days)d left")
                .font(Theme.monoMedium(11))
                .foregroundStyle(.white)
                .padding(.vertical, 3)
                .padding(.horizontal, 7)
                .background(Capsule().fill(color(days: days)))
        }
    }

    private func color(days: Int) -> Color {
        if days < 0 { return Theme.negative }
        if days <= 3 { return Theme.warning }
        return Theme.yarnSlate
    }
}

// Star rating: display-only, or editable when a binding is provided.
struct StarRatingView: View {
    var rating: Int
    var editable: Binding<Int>? = nil

    var body: some View {
        HStack(spacing: editable == nil ? 1 : 8) {
            ForEach(1...5, id: \.self) { n in
                let filled = n <= currentValue
                Text(filled ? "\u{2605}" : "\u{2606}")
                    .font(editable == nil ? Theme.displayFont(15) : Theme.displayFont(26))
                    .foregroundStyle(filled ? Theme.yarnOchre : Theme.textMuted)
                    .onTapGesture {
                        editable?.wrappedValue = n
                    }
                    .accessibilityLabel("\(n) star\(n == 1 ? "" : "s")")
            }
        }
        .accessibilityElement(children: editable == nil ? .ignore : .contain)
        .accessibilityLabel(editable == nil ? "\(rating) of 5 stars" : "Rating")
    }

    private var currentValue: Int {
        editable?.wrappedValue ?? rating
    }
}

// Shared empty-state block (port of .empty-state).
struct EmptyStateView: View {
    let title: String
    let hint: String

    var body: some View {
        VStack(spacing: 6) {
            Text(title)
                .font(Theme.displaySemiBold(17))
                .foregroundStyle(Theme.textPrimary)
            Text(hint)
                .font(Theme.displayFont(15))
                .foregroundStyle(Theme.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .patch()
    }
}

// Shared load-failure block with retry (screens' error state).
struct LoadErrorView: View {
    let message: String
    let retry: () async -> Void

    var body: some View {
        VStack(spacing: 12) {
            Text("Couldn't load this page.")
                .font(Theme.displaySemiBold(17))
                .foregroundStyle(Theme.textPrimary)
            Text(message)
                .font(Theme.monoFont(12))
                .foregroundStyle(Theme.textMuted)
                .multilineTextAlignment(.center)
            Button("Try again") {
                Task { await retry() }
            }
            .buttonStyle(.primarySmall)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .patch(accent: Theme.negative)
    }
}
