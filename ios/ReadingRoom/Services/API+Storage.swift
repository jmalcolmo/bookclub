// Storage uploads (port of the storage calls in profile.js / club.js).
// Path conventions are load-bearing: storage RLS scopes writes by the FIRST
// path segment - avatars under "<user uuid>/", club covers under
// "<club uuid>/". Buckets are public; display code just uses the public URL.

import Foundation
import Supabase

extension API {
    // Upload a baked avatar JPEG (512x512 from the cropper) and return its
    // public URL. Same path convention as the web: `${user.id}/${Date.now()}.jpg`.
    static func uploadAvatar(jpegData: Data) async throws -> String {
        let uid = try await currentUserId()
        let path = "\(uid.uuidString.lowercased())/\(millisNow()).jpg"
        try await supabase.storage.from("avatars")
            .upload(path, data: jpegData,
                    options: FileOptions(contentType: "image/jpeg", upsert: true))
        return try supabase.storage.from("avatars")
            .getPublicURL(path: path).absoluteString
    }

    // Upload a club cover JPEG under the club's folder (owner-only per RLS)
    // and return its public URL. Web path: `${club.id}/${Date.now()}.jpg`.
    static func uploadClubImage(clubId: UUID, jpegData: Data) async throws -> String {
        let path = "\(clubId.uuidString.lowercased())/\(millisNow()).jpg"
        try await supabase.storage.from("club-images")
            .upload(path, data: jpegData,
                    options: FileOptions(contentType: "image/jpeg", upsert: true))
        return try supabase.storage.from("club-images")
            .getPublicURL(path: path).absoluteString
    }

    private static func millisNow() -> Int {
        Int(Date().timeIntervalSince1970 * 1000)
    }
}
