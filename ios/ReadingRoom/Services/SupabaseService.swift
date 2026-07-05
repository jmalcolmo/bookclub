// The one Supabase client for the whole app, mirroring supabaseClient.js:
// session persisted (Keychain on iOS) and auto-refreshed. Every data access
// goes through the API namespace in this Services/ folder; views never touch
// this client directly (same boundary rule as the web app's api.js).

import Foundation
import Supabase

let supabase: SupabaseClient = {
    SupabaseClient(
        supabaseURL: AppConfig.supabaseURL,
        supabaseKey: AppConfig.supabaseAnonKey,
        options: SupabaseClientOptions(
            db: .init(
                encoder: PostgresCoding.encoder,
                decoder: PostgresCoding.decoder
            )
        )
    )
}()

// JSON coding shared by every table read/write. Models use camelCase property
// names; the wire format is snake_case (the backlog's "snake_case decoding").
// Dates need care: PostgREST emits ISO-8601 with a variable-length fractional
// second (e.g. 2026-07-02T12:34:56.789012+00:00), which Foundation's strict
// ISO8601 parser rejects, so parsing is done manually and defensively.
enum PostgresCoding {
    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        d.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            if let date = parseTimestamp(raw) { return date }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unrecognized timestamp: \(raw)"
            )
        }
        return d
    }()

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        e.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(isoString(from: date))
        }
        return e
    }()

    private static let isoWithFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    // "yyyy-MM-dd" (date columns) as local-independent UTC midnight.
    private static let dateOnly: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func isoString(from date: Date) -> String {
        isoWithFraction.string(from: date)
    }

    static func parseTimestamp(_ raw: String) -> Date? {
        // Normalize: Postgres may send "+00" or "+00:00"; a missing zone means UTC;
        // fractional seconds may be 1-6 digits (trim to 3 for ISO8601DateFormatter).
        var s = raw
        if s.count == 10 { return dateOnly.date(from: s) }
        if s.contains(" ") { s = s.replacingOccurrences(of: " ", with: "T") }
        // Ensure a timezone suffix
        if !s.hasSuffix("Z"), s.range(of: #"[+-]\d\d(:?\d\d)?$"#, options: .regularExpression) == nil {
            s += "Z"
        }
        // Expand short offsets like "+00" to "+00:00"
        if let r = s.range(of: #"[+-]\d\d$"#, options: .regularExpression) {
            s += ":00"
            _ = r
        }
        // Clamp fractional seconds to exactly 3 digits (pad or trim)
        if let dotRange = s.range(of: #"\.\d+"#, options: .regularExpression) {
            let digits = String(s[dotRange].dropFirst())
            let clamped = String((digits + "000").prefix(3))
            s = s.replacingCharacters(in: dotRange, with: "." + clamped)
            if let date = isoWithFraction.date(from: s) { return date }
        } else if let date = isoPlain.date(from: s) {
            return date
        }
        return isoWithFraction.date(from: s) ?? isoPlain.date(from: s)
    }
}
