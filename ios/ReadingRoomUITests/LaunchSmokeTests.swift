// Launch smoke test: the app must boot to something meaningful - the login
// card when signed out, or the tab bar when a session is restored. Google
// sign-in itself can't be automated (real account sheet), so deeper UI flows
// are exercised manually on device per the backlog's device matrix.

import XCTest

final class LaunchSmokeTests: XCTestCase {
    @MainActor
    func testLaunchShowsLoginOrShell() throws {
        let app = XCUIApplication()
        app.launch()

        let loginButton = app.buttons["Continue with Google"]
        let tabBar = app.tabBars.firstMatch

        // One of the two must appear within the boot window.
        let appeared = loginButton.waitForExistence(timeout: 10)
            || tabBar.waitForExistence(timeout: 10)
        XCTAssertTrue(appeared, "app booted to neither the login card nor the tab shell")
    }

    @MainActor
    func testLaunchPerformance() throws {
        if #available(iOS 17.0, *) {
            measure(metrics: [XCTApplicationLaunchMetric()]) {
                XCUIApplication().launch()
            }
        }
    }
}
