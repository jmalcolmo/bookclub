// Pure geometry/winner math for the spin-the-wheel picker - the Swift twin of
// src/wheel.js. No UI or DB deps, so it is the single source of truth for BOTH
// the picker view and the unit tests: the invariant that "the slice under the
// pointer equals the announced winner" is only meaningful if both share this.

import Foundation

enum WheelMath {
    // Rotation (in degrees, clockwise) that brings slice `target`'s CENTER
    // under the pointer at the top, after `turns` full spins for drama.
    // Slices are laid out clockwise from the top, each 360/n wide.
    static func spinRotation(target: Int, count n: Int, turns: Int) -> Double {
        let seg = 360.0 / Double(n)
        return Double(turns) * 360.0 + (360.0 - (Double(target) * seg + seg / 2.0))
    }

    // Which slice ends up under the top pointer for a given final rotation.
    // The winner is READ FROM the geometry (not chosen separately), so the
    // announced name can never disagree with where the marker points.
    static func winnerIndex(rotation: Double, count n: Int) -> Int {
        let seg = 360.0 / Double(n)
        let localAtTop = ((-rotation).truncatingRemainder(dividingBy: 360.0) + 360.0)
            .truncatingRemainder(dividingBy: 360.0)
        return Int(floor(localAtTop / seg)) % n
    }
}
