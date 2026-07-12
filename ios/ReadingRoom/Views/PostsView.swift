// Club posts (port of views/posts.js): a lightweight Twitter/X-style feed of
// short text updates and single-photo posts, scoped to one club. These are NOT
// reviews and carry NO page number, so there is NO spoiler gate - but they ARE
// club-member-scoped: RLS only ever returns/accepts posts for members of the
// club, so this view relies entirely on the server for access control (it never
// re-implements it). The web file input becomes PhotosPicker + the cropper.

import SwiftUI
import PhotosUI
import Observation

@MainActor
@Observable
final class PostsModel {
    let clubId: UUID

    var club: Club?
    var membership: ClubMember?
    var posts: [PostItem] = []
    var loading = true
    var loadError: String?

    @ObservationIgnored private let bag = RealtimeBag()

    init(clubId: UUID) {
        self.clubId = clubId
    }

    var isMember: Bool { membership != nil }

    func load() async {
        do {
            async let clubReq = API.getClub(clubId)
            async let membershipReq = API.myMembership(clubId: clubId)
            let (club, membership) = try await (clubReq, membershipReq)
            self.club = club
            self.membership = membership
            self.posts = try await API.clubPosts(clubId)   // RLS gates rows to members
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
        loading = false
    }

    func reloadPosts() async {
        if let posts = try? await API.clubPosts(clubId) { self.posts = posts }
    }

    // Live updates: club_posts is club-scoped, so filter to this club. Tokens are
    // cancelled on disappear.
    func startRealtime() async {
        let cid = clubId.uuidString.lowercased()
        let reload: @MainActor () -> Void = { [weak self] in
            guard let self else { return }
            self.bag.schedule { await self.reloadPosts() }
        }
        bag.add(await API.subscribe(channelName: "club-posts-\(cid)", table: "club_posts",
                                    filter: "club_id=eq.\(cid)", onChange: reload))
    }

    func stopRealtime() { bag.cancelAll() }
}

struct PostsView: View {
    let clubId: UUID

    @Environment(SessionStore.self) private var session
    @Environment(ToastCenter.self) private var toasts

    @State private var model: PostsModel
    @State private var draft = ""
    @State private var photoItem: PhotosPickerItem?
    @State private var pendingCrop: PendingCrop?
    @State private var pendingImageData: Data?
    @State private var posting = false

    init(clubId: UUID) {
        self.clubId = clubId
        _model = State(initialValue: PostsModel(clubId: clubId))
    }

    private var myId: UUID? { session.userId }

    var body: some View {
        Group {
            if model.loading && model.club == nil {
                ProgressView().tint(Theme.yarnSage)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = model.loadError, model.club == nil {
                ScrollView {
                    LoadErrorView(message: err) { await model.load() }
                        .padding(16)
                }
            } else {
                content
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle("Posts")
        .navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(item: $pendingCrop) { pending in
            ImageCropperView(image: pending.image, shape: .rounded) { data in
                pendingImageData = data   // held until the post is submitted
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
        .task {
            await model.load()
            await model.startRealtime()
        }
        .onDisappear { model.stopRealtime() }
        .refreshable { await model.load() }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Share a quick thought or a photo with the club. No page numbers, no spoiler gate.")
                    .font(Theme.displayFont(15).italic())
                    .foregroundStyle(Theme.textMuted)

                if model.isMember {
                    composer
                } else {
                    Text("Join this club to post.")
                        .font(Theme.displayFont(15))
                        .foregroundStyle(Theme.textMuted)
                        .padding(.vertical, 8)
                }

                if model.posts.isEmpty {
                    Text("no posts yet - be the first to share something.")
                        .font(Theme.displayFont(15))
                        .foregroundStyle(Theme.textMuted)
                        .padding(.top, 6)
                } else {
                    ForEach(model.posts) { item in
                        postCard(item)
                    }
                }
            }
            .padding(16)
        }
    }

    // MARK: composer

    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("what's on your mind?", text: $draft, axis: .vertical)
                .font(Theme.displayFont(17))
                .textFieldStyle(.plain)
                .lineLimit(3...6)

            if let data = pendingImageData, let img = UIImage(data: data) {
                ZStack(alignment: .topTrailing) {
                    Image(uiImage: img)
                        .resizable()
                        .scaledToFill()
                        .frame(height: 160)
                        .frame(maxWidth: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    Button {
                        pendingImageData = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(.white)
                            .shadow(radius: 2)
                            .padding(6)
                    }
                }
            }

            HStack {
                PhotosPicker(selection: $photoItem, matching: .images) {
                    Label(pendingImageData == nil ? "add photo" : "change photo",
                          systemImage: "photo")
                        .font(Theme.monoFont(13))
                }
                Spacer()
                Button {
                    submit()
                } label: {
                    if posting { ProgressView().tint(.white) } else { Text("post") }
                }
                .buttonStyle(.primary)
                .disabled(posting || (draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && pendingImageData == nil))
            }
        }
        .patch(seed: "post-compose-\(clubId)")
    }

    // MARK: a post card

    private func postCard(_ item: PostItem) -> some View {
        let mine = item.post.userId == myId
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ReaderLink(userId: item.post.userId) {
                    HStack(spacing: 8) {
                        AvatarView(profile: item.profile, size: 30)
                        Text(item.displayName)
                            .font(Theme.displaySemiBold(15))
                            .foregroundStyle(Theme.textPrimary)
                    }
                }
                Spacer()
                Text(Format.timeAgo(item.post.createdAt))
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
                if mine {
                    Menu {
                        Button("Delete", role: .destructive) { delete(item) }
                    } label: {
                        Image(systemName: "ellipsis")
                            .foregroundStyle(Theme.textMuted)
                            .padding(.leading, 4)
                    }
                }
            }
            if let body = item.post.body, !body.isEmpty {
                Text(body)
                    .font(Theme.displayFont(16))
                    .foregroundStyle(Theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let urlStr = item.post.imageUrl, let url = URL(string: urlStr) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else if phase.error != nil {
                        Color.clear
                    } else {
                        Rectangle().fill(Theme.surface2)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 220)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .patch(accent: Theme.yarnMoss, seed: item.id.uuidString)
    }

    // MARK: actions

    private func submit() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !posting, !(text.isEmpty && pendingImageData == nil) else { return }
        posting = true
        Task {
            defer { posting = false }
            do {
                var imageUrl: String?
                if let data = pendingImageData {
                    imageUrl = try await API.uploadPostImage(clubId: clubId, jpegData: data)
                }
                _ = try await API.addPost(clubId: clubId,
                                          body: text.isEmpty ? nil : text,
                                          imageUrl: imageUrl)
                draft = ""
                pendingImageData = nil
                toasts.show("Posted", .success)
                await model.reloadPosts()
            } catch {
                toasts.error(error)
            }
        }
    }

    private func delete(_ item: PostItem) {
        Task {
            do {
                try await API.deletePost(item.id)
                toasts.show("Post deleted")
                await model.reloadPosts()
            } catch {
                toasts.error(error)
            }
        }
    }
}

// MARK: - multi-club post composer (the "+" compose hub's "Create post" action)

// The same text + single-photo composer as PostsView (no page numbers, no
// spoiler gate) but with a CLUB MULTI-SELECT. On submit it uploads the photo
// ONCE (if any) and fans the post out to every selected club via
// API.addPostToClubs - one club_posts row per club; RLS still authorizes each
// insert. Presented as a sheet from the feed's compose hub. `clubs` is the
// feed's already-loaded club list, so no extra fetch is needed.
struct MultiClubPostComposerView: View {
    let clubs: [ClubSummary]
    var onPosted: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @Environment(ToastCenter.self) private var toasts

    @State private var draft = ""
    @State private var photoItem: PhotosPickerItem?
    @State private var pendingCrop: PendingCrop?
    @State private var pendingImageData: Data?
    @State private var selected: Set<UUID> = []
    @State private var posting = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Share a thought or a photo. Pick which clubs see it.")
                        .font(Theme.displayFont(15).italic())
                        .foregroundStyle(Theme.textMuted)

                    if clubs.isEmpty {
                        Text("Join or create a club first - posts go to a club.")
                            .font(Theme.displayFont(15))
                            .foregroundStyle(Theme.textMuted)
                    } else {
                        clubSelect
                    }

                    if let data = pendingImageData, let img = UIImage(data: data) {
                        ZStack(alignment: .topTrailing) {
                            Image(uiImage: img)
                                .resizable().scaledToFill()
                                .frame(height: 160)
                                .frame(maxWidth: .infinity)
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                            Button { pendingImageData = nil } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.system(size: 22))
                                    .foregroundStyle(.white).shadow(radius: 2).padding(6)
                            }
                        }
                    }

                    TextField("what's on your mind?", text: $draft, axis: .vertical)
                        .font(Theme.displayFont(17))
                        .lineLimit(3...6)

                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Label(pendingImageData == nil ? "add photo" : "change photo",
                              systemImage: "photo")
                            .font(Theme.monoFont(13))
                    }
                }
                .padding(16)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("New post")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Post") { submit() }
                        .disabled(posting || selected.isEmpty ||
                                  (draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                   && pendingImageData == nil))
                }
            }
            .fullScreenCover(item: $pendingCrop) { pending in
                ImageCropperView(image: pending.image, shape: .rounded) { data in
                    pendingImageData = data
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
            .onAppear {
                // Preselect when there's only one club - the common case.
                if clubs.count == 1, let only = clubs.first { selected = [only.id] }
            }
        }
    }

    private var clubSelect: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("POST TO")
                .font(Theme.monoFont(10)).kerning(1.2)
                .foregroundStyle(Theme.textMuted)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8)],
                      alignment: .leading, spacing: 8) {
                ForEach(clubs) { summary in
                    clubChip(summary)
                }
            }
        }
    }

    private func clubChip(_ summary: ClubSummary) -> some View {
        let isOn = selected.contains(summary.id)
        return Button {
            if isOn { selected.remove(summary.id) } else { selected.insert(summary.id) }
        } label: {
            HStack(spacing: 7) {
                ClubAvatarView(club: summary.club, size: 24)
                Text(summary.club.name)
                    .font(Theme.monoMedium(13))
                    .lineLimit(1)
                    .foregroundStyle(isOn ? Theme.surface : Theme.textPrimary)
            }
            .padding(.vertical, 6)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Capsule().fill(isOn ? Theme.yarnSage : Theme.surface2))
            .overlay(
                Capsule().stroke(isOn ? Theme.yarnSage : Theme.yarnBark, lineWidth: 2))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    private func submit() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let clubIds = Array(selected)
        guard !posting, !clubIds.isEmpty,
              !(text.isEmpty && pendingImageData == nil) else { return }
        posting = true
        Task {
            defer { posting = false }
            do {
                // Upload the photo once, then reuse its public URL across clubs.
                var imageUrl: String?
                if let data = pendingImageData {
                    imageUrl = try await API.uploadPostImage(clubId: clubIds[0], jpegData: data)
                }
                _ = try await API.addPostToClubs(clubIds: clubIds,
                                                 body: text.isEmpty ? nil : text,
                                                 imageUrl: imageUrl)
                toasts.show(clubIds.count > 1 ? "Posted to \(clubIds.count) clubs" : "Posted", .success)
                onPosted()
                dismiss()
            } catch {
                toasts.error(error)
            }
        }
    }
}
