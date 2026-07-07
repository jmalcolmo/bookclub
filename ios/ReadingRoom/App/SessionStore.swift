// Shared auth state: the signed-in user + their profile (port of src/store.js
// plus the boot/auth-change logic in src/main.js). One instance lives in the
// SwiftUI environment; RootView switches between login and the tab shell on
// `phase`.

import Foundation
import Observation
import Supabase

@MainActor
@Observable
final class SessionStore {
    enum Phase {
        case loading      // waiting for the initial session restore
        case signedOut
        case signedIn
    }

    private(set) var phase: Phase = .loading
    private(set) var userId: UUID?
    private(set) var userEmail: String?
    var profile: Profile?

    var isAdmin: Bool { profile?.isAdmin ?? false }

    @ObservationIgnored private var authListener: Task<Void, Never>?
    @ObservationIgnored private var pushRegistered = false

    // Start listening to auth state. supabase-swift emits the restored initial
    // session first, so this also performs the boot-time session check.
    func start() {
        guard authListener == nil else { return }
        installPushSink()
        authListener = Task { [weak self] in
            for await (_, session) in supabase.auth.authStateChanges {
                guard let self else { break }
                await self.apply(session: session)
            }
        }
    }

    // Route the AppDelegate's raw APNs callbacks into our session layer. Once we
    // have a hex token, persist it via API so the push Edge Function can find it.
    private func installPushSink() {
        PushRegistrar.onToken = { [weak self] token in
            guard self != nil else { return }
            Task { try? await API.registerDeviceToken(token, environment: apnsEnvironment) }
        }
        PushRegistrar.onError = { error in
            // Simulator, missing entitlement, or offline: nothing to store. Log
            // only — push is best-effort and must never block sign-in.
            print("APNs registration failed: \(error.localizedDescription)")
        }
    }

    func stop() {
        authListener?.cancel()
        authListener = nil
    }

    private func apply(session: Session?) async {
        guard let session else {
            userId = nil
            userEmail = nil
            profile = nil
            phase = .signedOut
            return
        }
        let uid = session.user.id
        userId = uid
        userEmail = session.user.email
        if profile?.id != uid {
            // The signup trigger can lag right after first sign-in; a missing
            // profile is fine, the UI falls back to "Reader" until refresh.
            profile = try? await API.getProfile(uid)
        }
        phase = .signedIn

        // Ask for push permission + APNs registration once we're signed in, so
        // the stored device_tokens row is owned by the right user. Best-effort:
        // the onToken sink upserts the token when it arrives.
        if !pushRegistered {
            pushRegistered = true
            PushRegistrar.requestAuthorizationAndRegister()
        }
    }

    // Re-pull my profile (after edits or when the signup trigger was lagging).
    func refreshProfile() async {
        guard let uid = userId else { return }
        if let fresh = try? await API.getProfile(uid) {
            profile = fresh
        }
    }

    func signOut() async {
        await AuthService.signOut()
        // authStateChanges fires with a nil session and flips phase to signedOut.
    }
}

// Which APNs gateway this build targets, matching the aps-environment
// entitlement: Debug builds register with the sandbox, Release with production.
// The Edge Function uses this to pick the right APNs host per token.
#if DEBUG
let apnsEnvironment = "sandbox"
#else
let apnsEnvironment = "production"
#endif
