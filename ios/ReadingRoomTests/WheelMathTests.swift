// Pure-math invariant for the spin wheel, exercised through the SAME WheelMath
// the picker view uses (mirror of the wheel step in tests/run.mjs): whatever
// slice CENTER we spin under the top pointer is exactly the slice
// winnerIndex() reads back, for every club size / target / turn count.

import XCTest
@testable import ReadingRoom

final class WheelMathTests: XCTestCase {
    func testMarkerAlwaysMatchesWinner() {
        for n in 2...12 {
            for target in 0..<n {
                for turns in [5, 6, 7] {
                    let rotation = WheelMath.spinRotation(target: target, count: n, turns: turns)
                    XCTAssertEqual(
                        WheelMath.winnerIndex(rotation: rotation, count: n), target,
                        "n=\(n) target=\(target) turns=\(turns)"
                    )
                }
            }
        }
    }

    func testSingleMemberWheelAlwaysWins() {
        for turns in [5, 6, 7] {
            let rotation = WheelMath.spinRotation(target: 0, count: 1, turns: turns)
            XCTAssertEqual(WheelMath.winnerIndex(rotation: rotation, count: 1), 0)
        }
    }

    func testTimestampParsing() {
        // The custom Postgres timestamp parser must accept every shape
        // PostgREST emits (fractional seconds of any length, short offsets,
        // bare dates) - regressions here would break every model decode.
        let samples = [
            "2026-07-02T12:34:56.789012+00:00",
            "2026-07-02T12:34:56.789+00:00",
            "2026-07-02T12:34:56.7+00:00",
            "2026-07-02T12:34:56+00:00",
            "2026-07-02T12:34:56Z",
            "2026-07-02T12:34:56.123456Z",
            "2026-07-02 12:34:56.123456+00",
            "2026-07-02",
        ]
        for s in samples {
            XCTAssertNotNil(PostgresCoding.parseTimestamp(s), "failed to parse \(s)")
        }
        // Round-trip: what we encode must decode.
        let now = Date()
        let encoded = PostgresCoding.isoString(from: now)
        let decoded = PostgresCoding.parseTimestamp(encoded)
        XCTAssertNotNil(decoded)
        XCTAssertEqual(decoded!.timeIntervalSince1970, now.timeIntervalSince1970, accuracy: 0.01)
    }
}
