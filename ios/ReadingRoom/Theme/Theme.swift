// "Deranged Granny Square" design tokens, ported from styles.css :root.
// Warm parchment + crochet feel: Crimson Pro for display text, DM Mono for
// labels/numbers, yarn accent colors, offset "stitched" shadows. Light values
// are the exact web hexes; dark values are hand-tuned parchment-at-night.

import SwiftUI
import UIKit

enum Theme {
    // MARK: base surfaces + text

    static let bg          = dynamic(light: 0xd6d0c4, dark: 0x272219)
    static let surface     = dynamic(light: 0xe8e3d9, dark: 0x322c22)
    static let surface2    = dynamic(light: 0xf0ebdf, dark: 0x3a3428)
    static let textPrimary = dynamic(light: 0x2a2520, dark: 0xece5d6)
    static let textMuted   = dynamic(light: 0x7a7068, dark: 0xa79b8a)

    // MARK: yarn accents (same in both modes; mid-tone enough to read on each)

    static let yarnOchre = color(0xb8a058)
    static let yarnSage  = color(0x7a9068)
    static let yarnRust  = color(0xa05838)
    static let yarnSlate = color(0x587888)
    static let yarnMauve = color(0x886878)
    static let yarnBark  = dynamic(light: 0x483828, dark: 0x8a745c)
    static let yarnMoss  = color(0x607050)
    static let yarnClay  = color(0x987860)

    // MARK: semantic

    static let positive = color(0x5a7a50)
    static let negative = color(0x8a4838)
    static let warning  = color(0x9a8040)

    // The ink used for the offset "stitched" shadows (web: rgba(72,56,40,...)).
    static let shadowInk = dynamic(light: 0x483828, dark: 0x000000)

    // MARK: fonts
    // CrimsonPro.ttf is a variable font; these are its named instances. Core
    // Text registers every instance except Regular under the "CrimsonProRoman-"
    // prefix - asking for "CrimsonPro-SemiBold" finds nothing and SwiftUI
    // silently substitutes the system font. All sizes are Dynamic Type-relative.

    static func displayFont(_ size: CGFloat) -> Font {
        .custom("CrimsonPro-Regular", size: size, relativeTo: .body)
    }

    static func displaySemiBold(_ size: CGFloat) -> Font {
        .custom("CrimsonProRoman-SemiBold", size: size, relativeTo: .body)
    }

    static func displayBold(_ size: CGFloat) -> Font {
        .custom("CrimsonProRoman-Bold", size: size, relativeTo: .body)
    }

    static func monoFont(_ size: CGFloat) -> Font {
        .custom("DMMono-Regular", size: size, relativeTo: .footnote)
    }

    static func monoMedium(_ size: CGFloat) -> Font {
        .custom("DMMono-Medium", size: size, relativeTo: .footnote)
    }

    // MARK: yarn helpers (port of ui.js)

    // The deterministic avatar palette (ui.js YARNS).
    private static let avatarYarns: [Color] = [
        color(0xb8a058), color(0x7a9068), color(0xa05838), color(0x587888),
        color(0x886878), color(0x607050), color(0x987860), color(0x483828),
    ]

    // Deterministic yarn color from a string (default avatars). Same 31-hash
    // as ui.js colorFor so web and iOS give a person the same color.
    static func colorFor(_ string: String) -> Color {
        var h: UInt32 = 0
        for scalar in string.unicodeScalars {
            h = h &* 31 &+ UInt32(scalar.value % 65536)
        }
        return avatarYarns[Int(h % UInt32(avatarYarns.count))]
    }

    // Resolve a --yarn-* accent name (as stored on clubs.accent) to its color.
    static func accent(_ name: String?) -> Color {
        switch name {
        case "yarn-ochre": return yarnOchre
        case "yarn-rust":  return yarnRust
        case "yarn-slate": return yarnSlate
        case "yarn-mauve": return yarnMauve
        case "yarn-bark":  return yarnBark
        case "yarn-moss":  return yarnMoss
        case "yarn-clay":  return yarnClay
        default:           return yarnSage
        }
    }

    // The accent choices offered when creating a club (clubs.js ACCENTS order).
    static let accentChoices: [(name: String, color: Color)] = [
        ("yarn-sage", yarnSage), ("yarn-rust", yarnRust), ("yarn-slate", yarnSlate),
        ("yarn-mauve", yarnMauve), ("yarn-ochre", yarnOchre), ("yarn-moss", yarnMoss),
        ("yarn-clay", yarnClay), ("yarn-bark", yarnBark),
    ]

    // MARK: plumbing

    private static func color(_ hex: UInt32) -> Color {
        Color(
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255
        )
    }

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xff) / 255,
                green: CGFloat((hex >> 8) & 0xff) / 255,
                blue: CGFloat(hex & 0xff) / 255,
                alpha: 1
            )
        })
    }
}
