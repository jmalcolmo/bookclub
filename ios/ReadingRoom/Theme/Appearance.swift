// Global UIKit appearance proxy for the chrome SwiftUI can't reach with a
// .font() modifier: UINavigationBar titles and UITabBar item labels. SwiftUI
// renders those through UIKit, which otherwise draws them in the system font —
// leaving them the only readable text in the app not wearing the theme face.
// Call Appearance.apply() once at launch (from ReadingRoomApp.init).
//
// Scope is deliberately fonts (+ the title's theme ink) only: we mirror the
// system's default backgrounds — opaque material when content scrolls under the
// bar, transparent at the scroll edge so large titles keep floating over the
// parchment — so nothing but the typeface changes.

import UIKit

enum Appearance {
    // Load a registered custom face, scaled with Dynamic Type; fall back to the
    // system font of the same size if the face is somehow unavailable, so the
    // bars degrade gracefully instead of vanishing.
    private static func uiFont(_ name: String, size: CGFloat, style: UIFont.TextStyle) -> UIFont {
        let base = UIFont(name: name, size: size) ?? .systemFont(ofSize: size)
        return UIFontMetrics(forTextStyle: style).scaledFont(for: base)
    }

    // Crimson Pro for display headings (nav titles), DM Mono for the small
    // label role (tab bar captions) — the same split styles.css uses on the web.
    static func apply() {
        applyNavigationBar()
        applyTabBar()
    }

    private static func applyNavigationBar() {
        let titleAttributes: [NSAttributedString.Key: Any] = [
            .font: uiFont("CrimsonProRoman-SemiBold", size: 17, style: .headline),
            .foregroundColor: UIColor(Theme.textPrimary),
        ]
        let largeTitleAttributes: [NSAttributedString.Key: Any] = [
            .font: uiFont("CrimsonProRoman-Bold", size: 30, style: .largeTitle),
            .foregroundColor: UIColor(Theme.textPrimary),
        ]

        // Opaque material once content slides under the bar (system default).
        let standard = UINavigationBarAppearance()
        standard.configureWithDefaultBackground()
        standard.titleTextAttributes = titleAttributes
        standard.largeTitleTextAttributes = largeTitleAttributes

        // Transparent at the scroll edge so large titles float over Theme.bg,
        // matching the untouched default look — only the typeface differs.
        let scrollEdge = UINavigationBarAppearance()
        scrollEdge.configureWithTransparentBackground()
        scrollEdge.titleTextAttributes = titleAttributes
        scrollEdge.largeTitleTextAttributes = largeTitleAttributes

        let bar = UINavigationBar.appearance()
        bar.standardAppearance = standard
        bar.compactAppearance = standard
        bar.scrollEdgeAppearance = scrollEdge
    }

    private static func applyTabBar() {
        let labelAttributes: [NSAttributedString.Key: Any] = [
            .font: uiFont("DMMono-Medium", size: 10, style: .caption2),
        ]

        let tab = UITabBarAppearance()
        tab.configureWithDefaultBackground()
        for layout in [
            tab.stackedLayoutAppearance,
            tab.inlineLayoutAppearance,
            tab.compactInlineLayoutAppearance,
        ] {
            layout.normal.titleTextAttributes = labelAttributes
            layout.selected.titleTextAttributes = labelAttributes
        }

        let bar = UITabBar.appearance()
        bar.standardAppearance = tab
        bar.scrollEdgeAppearance = tab
    }
}
