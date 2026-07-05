// My profile (port of views/profile.js): avatar with PhotosPicker + cropper,
// display name/bio editing, sign-out, and my personal shelf of finished books
// across all clubs.

import SwiftUI
import PhotosUI
import Observation

struct ProfileView: View {
    @Environment(SessionStore.self) private var session
    @Environment(ToastCenter.self) private var toasts

    @State private var displayName = ""
    @State private var bio = ""
    @State private var seeded = false
    @State private var saving = false
    @State private var history: [HistoryBook] = []
    @State private var photoItem: PhotosPickerItem?
    @State private var pendingCrop: PendingCrop?
    @State private var confirmSignOut = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                profileCard
                shelfSection
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle("My Profile")
        .task {
            seedForm()
            history = (try? await API.myReadingHistory()) ?? []
        }
        .refreshable {
            await session.refreshProfile()
            history = (try? await API.myReadingHistory()) ?? []
        }
        .fullScreenCover(item: $pendingCrop) { pending in
            ImageCropperView(image: pending.image, shape: .circle) { data in
                if let data { uploadAvatar(data) }
            }
        }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self),
                   let image = UIImage(data: data) {
                    pendingCrop = PendingCrop(image: image)
                }
                photoItem = nil
            }
        }
        .confirmationDialog("Sign out of The Reading Room?",
                            isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) {
                Task { await session.signOut() }
            }
        }
    }

    private var profileCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                AvatarView(profile: session.profile, size: 88)
                PhotosPicker(selection: $photoItem, matching: .images) {
                    Text("change photo")
                }
                .buttonStyle(.ghostSmall)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("display name")
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
                TextField("Reader", text: $displayName)
                    .font(Theme.displayFont(17))
                    .padding(8)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Theme.surface2))
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("bio (optional)")
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
                TextField("what do you like to read?", text: $bio, axis: .vertical)
                    .font(Theme.displayFont(16))
                    .lineLimit(3...5)
                    .padding(8)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Theme.surface2))
            }

            Button(saving ? "saving\u{2026}" : "Save profile") { save() }
                .buttonStyle(.primary)
                .disabled(saving || displayName.trimmingCharacters(in: .whitespaces).isEmpty)

            if let email = session.userEmail {
                Text("signed in as \(email)")
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
            }
            Button("sign out") { confirmSignOut = true }
                .buttonStyle(.ghostDanger)
        }
        .patch(accent: Theme.yarnSage, seed: "profile-card")
    }

    @ViewBuilder
    private var shelfSection: some View {
        StampTitle(text: "My Shelf - Books I've Read", small: true)
        if history.isEmpty {
            EmptyStateView(
                title: "no finished books yet.",
                hint: "books you mark finished - in any club - land on your shelf."
            )
        } else {
            ForEach(history) { item in
                NavigationLink(value: Route.book(clubId: item.book.clubId, bookId: item.book.id)) {
                    HStack(alignment: .top, spacing: 12) {
                        BookCoverView(coverUrl: item.book.coverUrl, width: 46)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.book.title)
                                .font(Theme.displaySemiBold(16))
                                .foregroundStyle(Theme.textPrimary)
                                .multilineTextAlignment(.leading)
                            if let author = item.book.author, !author.isEmpty {
                                Text(author)
                                    .font(Theme.displayFont(14))
                                    .foregroundStyle(Theme.textMuted)
                            }
                            Text("finished \(Format.date(item.myFinishedAt))")
                                .font(Theme.monoFont(11))
                                .foregroundStyle(Theme.textMuted)
                        }
                        Spacer()
                        if let rating = item.myRating {
                            HStack(spacing: 3) {
                                Text("\(rating)")
                                    .font(Theme.monoMedium(15))
                                    .foregroundStyle(Theme.textPrimary)
                                Text("\u{2605}")
                                    .font(Theme.displayFont(14))
                                    .foregroundStyle(Theme.yarnOchre)
                            }
                        } else {
                            Text("not rated")
                                .font(Theme.monoFont(11))
                                .foregroundStyle(Theme.textMuted)
                        }
                    }
                }
                .buttonStyle(.plain)
                .patch(seed: item.book.id.uuidString, padding: 12)
            }
        }
    }

    private func seedForm() {
        guard !seeded, let profile = session.profile else { return }
        displayName = profile.displayName
        bio = profile.bio ?? ""
        seeded = true
    }

    private func save() {
        guard !saving else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                guard let uid = session.userId else { return }
                let updated = try await API.updateProfile(uid, changes: API.ProfileChanges(
                    displayName: displayName.trimmingCharacters(in: .whitespaces),
                    bio: bio.trimmingCharacters(in: .whitespacesAndNewlines)
                ))
                session.profile = updated
                toasts.show("Profile saved", .success)
            } catch {
                toasts.error(error)
            }
        }
    }

    private func uploadAvatar(_ jpegData: Data) {
        Task {
            do {
                let url = try await API.uploadAvatar(jpegData: jpegData)
                guard let uid = session.userId else { return }
                let updated = try await API.updateProfile(uid, changes: API.ProfileChanges(avatarUrl: url))
                session.profile = updated
                toasts.show("Photo updated", .success)
            } catch {
                toasts.error(error)
            }
        }
    }
}
