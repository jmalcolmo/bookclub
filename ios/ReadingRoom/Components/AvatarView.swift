// Avatar chips (port of ui.js avatarHTML / clubAvatarHTML): the photo when one
// is set, otherwise initials on a deterministic yarn color. People are
// circles; clubs are rounded squares on their accent color.

import SwiftUI

struct AvatarView: View {
    let profile: Profile?
    var size: CGFloat = 36

    private var name: String { profile?.displayName ?? "Reader" }

    var body: some View {
        Group {
            if let urlString = profile?.avatarUrl, let url = URL(string: urlString) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        initialsView
                    }
                }
            } else {
                initialsView
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().stroke(Theme.shadowInk.opacity(0.2), lineWidth: 1))
        .accessibilityLabel(name)
    }

    private var initialsView: some View {
        ZStack {
            Theme.colorFor(name)
            Text(Format.initials(name))
                .font(Theme.monoMedium(size * 0.4))
                .foregroundStyle(.white)
        }
    }
}

struct ClubAvatarView: View {
    let club: Club
    var size: CGFloat = 48

    var body: some View {
        Group {
            if let urlString = club.photoUrl, let url = URL(string: urlString) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        initialsView
                    }
                }
            } else {
                initialsView
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.16))
        .overlay(
            RoundedRectangle(cornerRadius: size * 0.16)
                .stroke(Theme.shadowInk.opacity(0.2), lineWidth: 1)
        )
        .accessibilityLabel(club.name)
    }

    private var initialsView: some View {
        ZStack {
            Theme.accent(club.accent)
            Text(Format.clubInitials(club.name))
                .font(Theme.monoMedium(size * 0.36))
                .foregroundStyle(.white)
        }
    }
}
