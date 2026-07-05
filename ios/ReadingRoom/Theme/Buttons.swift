// Button styles ported from styles.css: .btn-primary (yarn-filled with offset
// shadow), .btn-ghost (outlined), plus small variants. Back buttons use the
// native navigation bar instead of the web's .btn-back.

import SwiftUI

struct PrimaryButtonStyle: ButtonStyle {
    var small = false
    var fill: Color = Theme.yarnSage

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(small ? Theme.monoMedium(13) : Theme.monoMedium(15))
            .foregroundStyle(Color.white)
            .padding(.vertical, small ? 8 : 12)
            .padding(.horizontal, small ? 12 : 18)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(fill)
            )
            .compositingGroup()
            .shadow(color: Theme.shadowInk.opacity(0.3),
                    radius: 0,
                    x: configuration.isPressed ? 1 : 3,
                    y: configuration.isPressed ? 1 : 3)
            .offset(x: configuration.isPressed ? 2 : 0,
                    y: configuration.isPressed ? 2 : 0)
            .opacity(configuration.isPressed ? 0.9 : 1)
    }
}

struct GhostButtonStyle: ButtonStyle {
    var small = false
    var danger = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(small ? Theme.monoFont(13) : Theme.monoFont(15))
            .foregroundStyle(danger ? Theme.negative : Theme.textPrimary)
            .padding(.vertical, small ? 7 : 11)
            .padding(.horizontal, small ? 11 : 16)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(Theme.surface2.opacity(configuration.isPressed ? 1 : 0.6))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(danger ? Theme.negative : Theme.textMuted, lineWidth: 1.5)
            )
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var primary: PrimaryButtonStyle { PrimaryButtonStyle() }
    static var primarySmall: PrimaryButtonStyle { PrimaryButtonStyle(small: true) }
}

extension ButtonStyle where Self == GhostButtonStyle {
    static var ghost: GhostButtonStyle { GhostButtonStyle() }
    static var ghostSmall: GhostButtonStyle { GhostButtonStyle(small: true) }
    static var ghostDanger: GhostButtonStyle { GhostButtonStyle(danger: true) }
}
