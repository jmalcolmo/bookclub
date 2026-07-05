// The signature ".patch" card: thick yarn-colored border, offset warm shadow,
// and a slight deterministic rotation so the layout feels hand-stitched.
// Port of the .patch class in styles.css/club.css.

import SwiftUI

struct PatchCard: ViewModifier {
    var accent: Color = Theme.yarnBark
    var rotation: Double = 0
    var padding: CGFloat = 14

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(Theme.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(accent, lineWidth: 3)
            )
            .compositingGroup()
            .shadow(color: Theme.shadowInk.opacity(0.25), radius: 0, x: 3, y: 3)
            .rotationEffect(.degrees(rotation))
    }
}

extension View {
    // A patch card. Pass a stable `seed` (a uuid string works) to get the
    // hand-placed +-0.4 degree tilt; omit it for a straight card.
    func patch(accent: Color = Theme.yarnBark,
               seed: String? = nil,
               padding: CGFloat = 14) -> some View {
        modifier(PatchCard(accent: accent,
                           rotation: PatchCard.tilt(for: seed),
                           padding: padding))
    }
}

extension PatchCard {
    static func tilt(for seed: String?) -> Double {
        guard let seed, !seed.isEmpty else { return 0 }
        var h: UInt32 = 0
        for scalar in seed.unicodeScalars {
            h = h &* 31 &+ UInt32(scalar.value % 65536)
        }
        // Between -0.4 and +0.4 degrees, deterministic per seed.
        return (Double(h % 81) - 40) / 100.0
    }
}

// The "STAMP TITLE" header style: Crimson Pro bold, uppercase, letterpressed.
struct StampTitle: View {
    let text: String
    var small = false

    var body: some View {
        Text(text.uppercased())
            .font(small ? Theme.displayBold(20) : Theme.displayBold(28))
            .kerning(1.2)
            .foregroundStyle(Theme.textPrimary)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .minimumScaleFactor(0.6)
            .fixedSize(horizontal: false, vertical: true)
    }
}
