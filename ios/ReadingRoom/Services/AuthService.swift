// Authentication (port of src/auth.js). Google sign-in via Supabase's OAuth
// flow over ASWebAuthenticationSession.
//
// Why not native GoogleSignIn + signInWithIdToken: GoogleSignIn 7.x builds on
// AppAuth, which auto-embeds a nonce in the returned ID token but exposes no
// way to read or set it. Supabase's signInWithIdToken then fails its
// "nonce must exist on both sides or neither" check every time, because the app
// can't supply the nonce baked into the token. The OAuth flow sidesteps this
// entirely: the whole handshake (nonce included) happens server-side between
// Supabase and Google, and the app just receives the session on the redirect.
// It also reuses the same Google *web* OAuth client that already powers the web
// app - no separate iOS client or "Authorized Client IDs" entry needed.

import AuthenticationServices
import Foundation
import Supabase

enum AuthError: LocalizedError {
    case cancelled

    var errorDescription: String? {
        switch self {
        case .cancelled: return "Sign-in was cancelled."
        }
    }
}

enum AuthService {
    // Custom scheme the OAuth redirect lands on. ASWebAuthenticationSession
    // captures this scheme itself (no Info.plist URL type needed), but the full
    // URL MUST be added to Supabase Auth -> URL Configuration -> Redirect URLs.
    static let redirectURL = URL(string: "com.jmalcolmo.thereadingroom://login-callback")!

    // Presents the Google account flow in a secure web session and completes
    // the Supabase sign-in. SessionStore's auth-state listener then flips the
    // app into the signed-in shell.
    @MainActor
    static func signInWithGoogle() async throws {
        do {
            try await supabase.auth.signInWithOAuth(
                provider: .google,
                redirectTo: redirectURL
            ) { session in
                // Keep the shared cookie jar so returning users skip re-consent.
                session.prefersEphemeralWebBrowserSession = false
            }
        } catch {
            let ns = error as NSError
            if ns.domain == ASWebAuthenticationSessionErrorDomain,
               ns.code == ASWebAuthenticationSessionError.Code.canceledLogin.rawValue {
                throw AuthError.cancelled
            }
            throw error
        }
    }

    static func signOut() async {
        try? await supabase.auth.signOut()
    }
}
