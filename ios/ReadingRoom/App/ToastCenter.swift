// Toasts (port of ui.js toast()): transient confirmations and errors that
// float above whatever screen is showing. Views reach the shared center via
// the environment and call toasts.show(...) / toasts.error(...).

import Foundation
import Observation
import SwiftUI

@MainActor
@Observable
final class ToastCenter {
    enum Kind {
        case info, success, error
    }

    struct Toast: Identifiable, Equatable {
        let id = UUID()
        let message: String
        let kind: Kind
    }

    private(set) var toasts: [Toast] = []

    func show(_ message: String, _ kind: Kind = .info) {
        let toast = Toast(message: message, kind: kind)
        toasts.append(toast)
        // Same lifetime as the web (3.2s), removal animated by the overlay.
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 3_200_000_000)
            toasts.removeAll { $0.id == toast.id }
        }
    }

    func error(_ error: Error) {
        show(error.localizedDescription, .error)
    }

    func dismiss(_ toast: Toast) {
        toasts.removeAll { $0.id == toast.id }
    }
}

// The floating stack. RootView attaches this once, above everything.
struct ToastOverlay: View {
    @Environment(ToastCenter.self) private var center

    var body: some View {
        VStack(spacing: 8) {
            ForEach(center.toasts) { toast in
                ToastChip(toast: toast)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .onTapGesture { center.dismiss(toast) }
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 8)
        .padding(.horizontal, 16)
        .animation(.spring(duration: 0.3), value: center.toasts)
        .allowsHitTesting(!center.toasts.isEmpty)
    }
}

private struct ToastChip: View {
    let toast: ToastCenter.Toast

    var body: some View {
        Text(toast.message)
            .font(Theme.monoFont(13))
            .foregroundStyle(Theme.textPrimary)
            .padding(.vertical, 10)
            .padding(.horizontal, 14)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(Theme.surface2)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(borderColor, lineWidth: 2)
            )
            .compositingGroup()
            .shadow(color: Theme.shadowInk.opacity(0.25), radius: 0, x: 3, y: 3)
    }

    private var borderColor: Color {
        switch toast.kind {
        case .info: return Theme.yarnSlate
        case .success: return Theme.positive
        case .error: return Theme.negative
        }
    }
}
