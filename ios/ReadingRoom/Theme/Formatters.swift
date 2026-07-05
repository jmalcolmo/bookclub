// Small formatting helpers shared across views (port of ui.js). No HTML
// escaping needed on iOS: SwiftUI Text renders strings as plain text.

import Foundation

enum Format {
    // "just now" / "5m ago" / "3h ago" / "2d ago" / short date (ui.js timeAgo).
    static func timeAgo(_ date: Date) -> String {
        let d = Date().timeIntervalSince(date)
        if d < 60 { return "just now" }
        if d < 3600 { return "\(Int(d / 60))m ago" }
        if d < 86400 { return "\(Int(d / 3600))h ago" }
        if d < 604800 { return "\(Int(d / 86400))d ago" }
        return shortDate.string(from: date)
    }

    // "Jul 2, 2026" (ui.js fmtDate).
    static func date(_ date: Date?) -> String {
        guard let date else { return "\u{2014}" }
        return mediumDate.string(from: date)
    }

    // Days until a deadline; negative = overdue (ui.js daysUntil).
    static func daysUntil(_ date: Date?) -> Int? {
        guard let date else { return nil }
        return Int(ceil(date.timeIntervalSinceNow / 86400))
    }

    // First letters of the first two words (ui.js initials).
    static func initials(_ name: String?) -> String {
        let words = (name ?? "?")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(separator: " ")
            .prefix(2)
        let letters = words.compactMap { $0.first.map { String($0).uppercased() } }
        let joined = letters.joined()
        return joined.isEmpty ? "?" : joined
    }

    // Club initials: strip leading emoji/symbols (club names often start with
    // one) then initial the first two real words (ui.js clubInitials).
    static func clubInitials(_ name: String?) -> String {
        let cleaned = String((name ?? "").unicodeScalars.map { scalar -> Character in
            if CharacterSet.alphanumerics.contains(scalar) || scalar == " " {
                return Character(scalar)
            }
            return " "
        }).trimmingCharacters(in: .whitespaces)
        return initials(cleaned.isEmpty ? name : cleaned)
    }

    // "3 members" / "1 member" style pluralizer.
    static func count(_ n: Int, _ singular: String, _ plural: String? = nil) -> String {
        n == 1 ? "1 \(singular)" : "\(n) \(plural ?? singular + "s")"
    }

    private static let shortDate: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .short
        return f
    }()

    private static let mediumDate: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MMM d, yyyy"
        return f
    }()
}
