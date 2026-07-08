// My profile (port of views/profile.js): avatar with PhotosPicker + cropper,
// display name/bio editing, sign-out, and my personal shelf of finished books
// across all clubs.

import SwiftUI
import PhotosUI
import Observation

struct ProfileView: View {
    // When set, this shows ANOTHER reader's read-only profile with a follow
    // control (reached from the follow feed). When nil, it's MY editable profile.
    var readerId: UUID? = nil

    @Environment(SessionStore.self) private var session
    @Environment(ToastCenter.self) private var toasts

    @State private var displayName = ""
    @State private var bio = ""
    @State private var seeded = false
    @State private var saving = false
    @State private var editingProfile = false
    @State private var showAllActivity = false
    @State private var showAllShelf = false
    @State private var history: [HistoryBook] = []
    @State private var activity: [ActivityItem] = []
    @State private var activityLoaded = false
    @State private var photoItem: PhotosPickerItem?
    @State private var pendingCrop: PendingCrop?
    @State private var confirmSignOut = false

    // Other-reader state.
    @State private var reader: Profile?
    @State private var readerLoaded = false
    @State private var isFollowing = false
    @State private var followBusy = false
    // Their shelf: only the rows RLS lets ME see (their finished progress in
    // clubs we share, or via the follow path). Empty just hides the section -
    // no client-side gating is ever added here.
    @State private var otherHistory: [HistoryBook] = []
    @State private var showAllOtherShelf = false

    // Am I looking at someone else? (readerId is nil, or my own, => self view)
    private var isOther: Bool {
        guard let readerId else { return false }
        return readerId != session.userId
    }

    var body: some View {
        if isOther {
            otherBody
        } else {
            selfBody
        }
    }

    // MARK: - Another reader (read-only + follow control)

    private var otherBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let reader {
                    VStack(alignment: .leading, spacing: 14) {
                        AvatarView(profile: reader, size: 88)
                        Text(reader.displayName)
                            .font(Theme.displaySemiBold(20))
                            .foregroundStyle(Theme.textPrimary)
                        if let bio = reader.bio, !bio.isEmpty {
                            Text(bio)
                                .font(Theme.displayFont(16))
                                .foregroundStyle(Theme.textPrimary)
                        } else {
                            Text("no bio yet.")
                                .font(Theme.displayFont(15))
                                .foregroundStyle(Theme.textMuted)
                        }
                        Group {
                            if isFollowing {
                                Button("Following \u{2713}") { toggleFollow() }
                                    .buttonStyle(.ghost)
                            } else {
                                Button("Follow") { toggleFollow() }
                                    .buttonStyle(.primary)
                            }
                        }
                        .disabled(followBusy)
                        Text("following surfaces their solo reading on your feed.")
                            .font(Theme.monoFont(11))
                            .foregroundStyle(Theme.textMuted)
                    }
                    .patch(accent: Theme.yarnSage, seed: "reader-card")

                    otherShelfSection
                } else if readerLoaded {
                    EmptyStateView(
                        title: "this reader isn't visible to you.",
                        hint: "you can see a reader once you share a club or follow them."
                    )
                } else {
                    ProgressView().tint(Theme.yarnSage)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(16)
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle("Reader")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadReader() }
    }

    private func loadReader() async {
        guard let readerId, !readerLoaded else { return }
        reader = try? await API.getProfile(readerId)
        isFollowing = (try? await API.isFollowing(readerId)) ?? false
        otherHistory = (try? await API.readingHistoryFor(readerId)) ?? []
        readerLoaded = true
    }

    // Their shelf (web parity: renderOtherProfile's "BOOKS THEY'VE READ").
    // Tapping a book opens THEIR personal involvement view - keyed by this
    // reader's id; what shows inside is still spoiler-gated to ME by RLS.
    @ViewBuilder
    private var otherShelfSection: some View {
        if let readerId, !otherHistory.isEmpty {
            StampTitle(text: "Their Shelf - Books They've Read", small: true)
            VStack(spacing: 0) {
                let shown = showAllOtherShelf ? otherHistory : Array(otherHistory.prefix(3))
                ForEach(shown.indices, id: \.self) { i in
                    if i > 0 { Divider().overlay(Theme.yarnClay.opacity(0.5)) }
                    NavigationLink(value: Route.bookInvolvement(ownerId: readerId,
                                                                bookId: shown[i].book.id)) {
                        shelfRow(shown[i])
                    }
                    .buttonStyle(.plain)
                    .padding(.vertical, 10)
                }
                if otherHistory.count > 3 {
                    Button(showAllOtherShelf ? "show less" : "show all \(otherHistory.count) books") {
                        withAnimation { showAllOtherShelf.toggle() }
                    }
                    .buttonStyle(.ghostSmall)
                    .padding(.top, 8)
                }
            }
            .patch(seed: "other-shelf-box", padding: 14)
        }
    }

    private func toggleFollow() {
        guard let readerId, !followBusy else { return }
        followBusy = true
        Task {
            defer { followBusy = false }
            do {
                if isFollowing {
                    try await API.unfollow(readerId)
                    isFollowing = false
                    toasts.show("Unfollowed", .success)
                } else {
                    try await API.follow(readerId)
                    isFollowing = true
                    toasts.show("Following", .success)
                }
            } catch {
                toasts.error(error)
            }
        }
    }

    // MARK: - My own profile

    private var selfBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                profileCard
                activitySection
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
            activity = (try? await API.myActivity()) ?? []
            activityLoaded = true
        }
        .refreshable {
            await session.refreshProfile()
            history = (try? await API.myReadingHistory()) ?? []
            activity = (try? await API.myActivity()) ?? []
            activityLoaded = true
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

    // Two modes (web parity): a clean read-only VIEW (default) and the EDIT
    // form (change photo / name / bio), reached via the "Edit profile" button.
    @ViewBuilder
    private var profileCard: some View {
        if editingProfile {
            profileEditCard
        } else {
            profileViewCard
        }
    }

    private var profileViewCard: some View {
        VStack(alignment: .center, spacing: 12) {
            AvatarView(profile: session.profile, size: 88)
            Text(session.profile?.displayName ?? "Reader")
                .font(Theme.displaySemiBold(20))
                .foregroundStyle(Theme.textPrimary)
            if let bio = session.profile?.bio, !bio.isEmpty {
                Text(bio)
                    .font(Theme.displayFont(16))
                    .foregroundStyle(Theme.textPrimary)
                    .multilineTextAlignment(.center)
            } else {
                Text("no bio yet.")
                    .font(Theme.displayFont(15))
                    .foregroundStyle(Theme.textMuted)
            }
            if let email = session.userEmail {
                Text("signed in as \(email)")
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
            }
            HStack(spacing: 12) {
                Button("\u{270E} Edit profile") {
                    seeded = false
                    seedForm()
                    editingProfile = true
                }
                .buttonStyle(.primary)
                Button("sign out") { confirmSignOut = true }
                    .buttonStyle(.ghostDanger)
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity)
        .patch(accent: Theme.yarnSage, seed: "profile-card")
    }

    private var profileEditCard: some View {
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

            HStack(spacing: 12) {
                Button(saving ? "saving\u{2026}" : "Save profile") { save() }
                    .buttonStyle(.primary)
                    .disabled(saving || displayName.trimmingCharacters(in: .whitespaces).isEmpty)
                Button("cancel") { editingProfile = false }
                    .buttonStyle(.ghost)
            }
        }
        .patch(accent: Theme.yarnSage, seed: "profile-card")
    }

    // MARK: - activity (who liked / commented on my stuff)

    // Both lists live in ONE box showing at most three rows; the toggle expands
    // the rest in place so the profile never becomes a giant scroll (web parity).
    @ViewBuilder
    private var activitySection: some View {
        StampTitle(text: "Activity", small: true)
        if !activityLoaded {
            ProgressView().tint(Theme.yarnSage)
                .frame(maxWidth: .infinity)
        } else if activity.isEmpty {
            EmptyStateView(
                title: "no activity yet.",
                hint: "when someone likes or comments on your reactions, it shows up here."
            )
        } else {
            VStack(spacing: 0) {
                let shown = showAllActivity ? activity : Array(activity.prefix(3))
                ForEach(shown.indices, id: \.self) { i in
                    if i > 0 { Divider().overlay(Theme.yarnClay.opacity(0.5)) }
                    NavigationLink(value: shown[i].route) {
                        activityRow(shown[i])
                    }
                    .buttonStyle(.plain)
                    .padding(.vertical, 10)
                }
                if activity.count > 3 {
                    Button(showAllActivity ? "show less" : "show all \(activity.count) activity") {
                        withAnimation { showAllActivity.toggle() }
                    }
                    .buttonStyle(.ghostSmall)
                    .padding(.top, 8)
                }
            }
            .patch(seed: "activity-box", padding: 14)
        }
    }

    private func activityRow(_ item: ActivityItem) -> some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarView(profile: item.actor, size: 32)
            VStack(alignment: .leading, spacing: 3) {
                (Text(item.actor?.displayName ?? "Someone").fontWeight(.semibold)
                    + Text(" \(verb(item)) \u{00B7} ")
                    + Text(item.book.title).italic().foregroundColor(Theme.yarnRust))
                    .font(Theme.displayFont(15))
                    .foregroundStyle(Theme.textPrimary)
                    .multilineTextAlignment(.leading)
                if let quote = item.kind == .reply ? item.body : item.snippet,
                   !quote.isEmpty {
                    Text("\u{201C}\(quote)\u{201D}")
                        .font(Theme.displayFont(13))
                        .foregroundStyle(Theme.textMuted)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                Text(Format.timeAgo(item.at))
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
            }
            Spacer()
            Text(icon(item))
                .font(.system(size: 15))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func verb(_ item: ActivityItem) -> String {
        switch item.kind {
        case .like: return "liked your \(item.what.rawValue)"
        case .emoji(let e): return "reacted \(e) to your \(item.what.rawValue)"
        case .reply: return "commented on your \(item.what.rawValue)"
        }
    }

    private func icon(_ item: ActivityItem) -> String {
        switch item.kind {
        case .like: return "\u{1F44D}"
        case .emoji(let e): return e
        case .reply: return "\u{1F4AC}"
        }
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
            VStack(spacing: 0) {
                let shown = showAllShelf ? history : Array(history.prefix(3))
                ForEach(shown.indices, id: \.self) { i in
                    if i > 0 { Divider().overlay(Theme.yarnClay.opacity(0.5)) }
                    // Tapping a shelf book opens MY personal involvement view for
                    // it (my own reactions/replies/progress), not the whole club
                    // feed - keyed by my id.
                    NavigationLink(value: Route.bookInvolvement(ownerId: session.userId ?? shown[i].book.clubId,
                                                                bookId: shown[i].book.id)) {
                        shelfRow(shown[i])
                    }
                    .buttonStyle(.plain)
                    .padding(.vertical, 10)
                }
                if history.count > 3 {
                    Button(showAllShelf ? "show less" : "show all \(history.count) books") {
                        withAnimation { showAllShelf.toggle() }
                    }
                    .buttonStyle(.ghostSmall)
                    .padding(.top, 8)
                }
            }
            .patch(seed: "shelf-box", padding: 14)
        }
    }

    private func shelfRow(_ item: HistoryBook) -> some View {
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
        .frame(maxWidth: .infinity, alignment: .leading)
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
                editingProfile = false // back to the clean view
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
