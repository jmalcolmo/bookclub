// Guards the theme's font-name strings against the variable-font naming trap:
// CrimsonPro.ttf registers its non-Regular instances under "CrimsonProRoman-*",
// and a wrong name doesn't error — UIKit/SwiftUI silently substitute the system
// font, which is exactly the off-theme look this test exists to catch.

import XCTest
@testable import ReadingRoom

final class ThemeFontTests: XCTestCase {
    func testEveryThemeFaceResolvesToItsRealFamily() {
        let faces: [(name: String, family: String)] = [
            ("CrimsonPro-Regular", "Crimson Pro"),
            ("CrimsonProRoman-SemiBold", "Crimson Pro"),
            ("CrimsonProRoman-Bold", "Crimson Pro"),
            ("DMMono-Regular", "DM Mono"),
            ("DMMono-Medium", "DM Mono"),
        ]
        for face in faces {
            let font = UIFont(name: face.name, size: 17)
            XCTAssertNotNil(font, "\(face.name) is not registered - check the name against the bundled TTF")
            XCTAssertEqual(font?.familyName, face.family, "\(face.name) resolved outside its family")
        }
    }
}
