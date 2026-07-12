// Push notifications (APNs) registration. There is no web equivalent - the web
// app has no push. This is the iOS-only path that:
//   1. asks the user for notification permission,
//   2. registers with APNs for a device token,
//   3. hands the token back to SessionStore, which stores it via API so the
//      push Edge Function can look up who to notify.
//
// The actual APNs token callbacks land on the UIApplicationDelegate, so this
// file also provides an AppDelegate that ReadingRoomApp adopts via
// @UIApplicationDelegateAdaptor. The delegate forwards the token (or an error)
// to a MainActor sink that SessionStore installs at boot.

import Foundation
import UIKit
import UserNotifications

// A process-wide sink the AppDelegate forwards raw APNs results to. SessionStore
// installs `onToken` at boot; keeping it here (not on the delegate) decouples the
// UIKit delegate from our async/Observable session layer.
@MainActor
enum PushRegistrar {
    // Called with the hex-encoded APNs device token once registration succeeds.
    static var onToken: ((String) -> Void)?
    // Called if APNs registration fails (no entitlement, no network, simulator…).
    static var onError: ((Error) -> Void)?

    // Ask for permission and, if granted, kick off APNs registration. Safe to
    // call every launch - iOS coalesces and won't re-prompt once decided.
    static func requestAuthorizationAndRegister() {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            guard granted else { return }
            Task { @MainActor in
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    // Encode Apple's opaque Data token as the lowercase hex string APNs expects.
    static func hexString(from tokenData: Data) -> String {
        tokenData.map { String(format: "%02x", $0) }.joined()
    }
}

// UIKit application delegate, adopted by ReadingRoomApp via the SwiftUI
// @UIApplicationDelegateAdaptor. Only remote-notification registration lives
// here; everything else stays in the SwiftUI app lifecycle.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = PushRegistrar.hexString(from: deviceToken)
        Task { @MainActor in PushRegistrar.onToken?(token) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in PushRegistrar.onError?(error) }
    }
}
