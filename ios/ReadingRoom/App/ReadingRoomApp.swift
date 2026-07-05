// App entry point: boots the auth state store, wires the Google Sign-In URL
// callback, and hands the environment (session + toasts) to the root shell.

import SwiftUI

@main
struct ReadingRoomApp: App {
    @State private var session = SessionStore()
    @State private var toasts = ToastCenter()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(toasts)
                .task { session.start() }
        }
    }
}
