// The signed-out screen (port of views/login.js): the pitch plus one
// "Continue with Google" button. Sign-in success flows through
// SessionStore's auth listener; this view only kicks it off.

import SwiftUI

struct LoginView: View {
    @Environment(ToastCenter.self) private var toasts
    @State private var signingIn = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 14) {
                Text("\u{1F4DA}")
                    .font(.system(size: 46))
                StampTitle(text: "The Reading Room")
                Text("a book club, stitched together")
                    .font(Theme.displayFont(17).italic())
                    .foregroundStyle(Theme.textMuted)
                Text("Join a club, track what everyone's reading, drop spoiler-safe reactions, and let fate (or a vote) pick who chooses the next book.")
                    .font(Theme.displayFont(16))
                    .foregroundStyle(Theme.textPrimary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 6)

                Button {
                    signIn()
                } label: {
                    HStack(spacing: 10) {
                        Text("G")
                            .font(Theme.displayBold(18))
                            .frame(width: 26, height: 26)
                            .background(Circle().fill(Color.white.opacity(0.25)))
                        Text(signingIn ? "Signing in\u{2026}" : "Continue with Google")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.primary)
                .disabled(signingIn)
                .padding(.top, 8)

                Text("your reactions stay hidden from anyone who hasn't read that far.")
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
                    .multilineTextAlignment(.center)
            }
            .padding(22)
            .patch(accent: Theme.yarnSage, seed: "login-card")
            .padding(.horizontal, 24)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg.ignoresSafeArea())
    }

    private func signIn() {
        guard !signingIn else { return }
        signingIn = true
        Task {
            defer { signingIn = false }
            do {
                try await AuthService.signInWithGoogle()
                // SessionStore's authStateChanges listener flips the app to
                // the signed-in shell.
            } catch AuthError.cancelled {
                // User backed out; no toast needed.
            } catch {
                toasts.error(error)
            }
        }
    }
}
