// Environment configuration. The iOS analogue of config.js: instead of picking
// dev/prod by hostname, the values are baked in at build time by the active
// xcconfig (Debug -> Config/Dev.xcconfig, Release -> Config/Prod.xcconfig) and
// surfaced here through Info.plist. Only publishable anon keys ever ship in the
// bundle; RLS enforces every rule server-side.

import Foundation

enum AppConfig {
    static let envName: String = infoString("SupabaseEnvName")

    static let supabaseURL: URL = {
        let raw = infoString("SupabaseURL")
        guard let url = URL(string: raw), raw.hasPrefix("https://") else {
            fatalError("[AppConfig] SupabaseURL is missing or malformed: \(raw)")
        }
        return url
    }()

    static let supabaseAnonKey: String = {
        let key = infoString("SupabaseAnonKey")
        precondition(!key.isEmpty && !key.contains("YOUR_"),
                     "[AppConfig] Supabase anon key is not set. Check Config/*.xcconfig.")
        return key
    }()

    static var isDev: Bool { envName == "dev" }

    private static func infoString(_ key: String) -> String {
        (Bundle.main.object(forInfoDictionaryKey: key) as? String) ?? ""
    }
}
