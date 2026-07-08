// Full-screen STORY VIEWER + composer (port of src/views/stories.js). Presented
// over the feed from the stories strip. Given the author-grouped stories from
// API.activeStories() and a starting group index, it plays each author's
// stories in order with a row of top progress bars, tap-to-advance (left = back,
// right = forward, crossing authors), auto-advance on a timer, and a
// mark-as-seen call (API.markStoryViewed) as each story is shown.
//
// There is NO spoiler gate here and no client-side visibility logic — the groups
// handed in already came back RLS-filtered from API.activeStories().

import SwiftUI
import PhotosUI

private let storyDwell: TimeInterval = 5.0   // auto-advance dwell per story

struct StoryViewerView: View {
    let groups: [StoryGroup]
    @State var groupIndex: Int
    // Called as each story is marked seen so the caller can repaint rings.
    var onSeen: (UUID) -> Void = { _ in }

    @Environment(\.dismiss) private var dismiss
    @State private var storyIndex = 0
    @State private var progress: Double = 0     // 0…1 for the active bar
    @State private var timer: Timer?
    @State private var seenLocally: Set<UUID> = []

    private var group: StoryGroup? {
        groups.indices.contains(groupIndex) ? groups[groupIndex] : nil
    }
    private var current: StoryItem? {
        guard let group, group.stories.indices.contains(storyIndex) else { return nil }
        return group.stories[storyIndex]
    }

    var body: some View {
        ZStack {
            Color(red: 0.08, green: 0.06, blue: 0.05).ignoresSafeArea()

            if let group, let story = current {
                VStack(spacing: 0) {
                    progressBars(group)
                    topBar(group, story)
                    content(story)
                }
            }

            // Tap zones: left third = back, right two-thirds = forward.
            HStack(spacing: 0) {
                Color.clear.contentShape(Rectangle())
                    .frame(maxWidth: .infinity).onTapGesture { prev() }
                Color.clear.contentShape(Rectangle())
                    .frame(maxWidth: .infinity).onTapGesture { next() }
                    .frame(maxWidth: .infinity)
            }
            .padding(.top, 60)
        }
        .onAppear { startStory() }
        .onDisappear { timer?.invalidate() }
    }

    // MARK: pieces

    private func progressBars(_ group: StoryGroup) -> some View {
        HStack(spacing: 4) {
            ForEach(Array(group.stories.enumerated()), id: \.offset) { i, _ in
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.3))
                        Capsule().fill(Theme.surface)
                            .frame(width: geo.size.width * fillFraction(for: i))
                    }
                }
                .frame(height: 3)
            }
        }
        .padding(.horizontal, 10)
        .padding(.top, 10)
        .padding(.bottom, 6)
    }

    private func fillFraction(for i: Int) -> Double {
        if i < storyIndex { return 1 }
        if i == storyIndex { return progress }
        return 0
    }

    private func topBar(_ group: StoryGroup, _ story: StoryItem) -> some View {
        HStack(spacing: 8) {
            AvatarView(profile: group.profile, size: 34)
            Text(group.displayName)
                .font(Theme.monoMedium(14))
                .foregroundStyle(Theme.surface)
            Text(Format.timeAgo(story.story.createdAt))
                .font(Theme.monoFont(11))
                .foregroundStyle(Color.white.opacity(0.6))
            Spacer()
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Theme.surface)
            }
            .accessibilityLabel("Close stories")
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 8)
    }

    @ViewBuilder
    private func content(_ story: StoryItem) -> some View {
        ZStack(alignment: .bottom) {
            if let urlStr = story.story.imageUrl, let url = URL(string: urlStr) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFit()
                    } else if phase.error != nil {
                        Color.clear
                    } else {
                        ProgressView().tint(Theme.surface)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                if let body = story.story.body, !body.isEmpty {
                    Text(body)
                        .font(Theme.displayFont(18))
                        .foregroundStyle(Theme.surface)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(18)
                        .background(
                            LinearGradient(colors: [.clear, .black.opacity(0.75)],
                                           startPoint: .top, endPoint: .bottom))
                }
            } else if let body = story.story.body {
                // Text-only story: a warm mauve card, centered caption.
                Text(body)
                    .font(Theme.displayFont(26))
                    .foregroundStyle(Theme.surface)
                    .multilineTextAlignment(.center)
                    .padding(28)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Theme.yarnMauve.opacity(0.55))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    // MARK: playback

    private func startStory() {
        guard let story = current else { dismiss(); return }
        progress = 0
        markSeen(story)
        timer?.invalidate()
        // ~60fps tick; advance progress and cross to the next story at full.
        timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            Task { @MainActor in
                progress += 0.05 / storyDwell
                if progress >= 1 { next() }
            }
        }
    }

    private func next() {
        guard let group else { dismiss(); return }
        if storyIndex < group.stories.count - 1 {
            storyIndex += 1
        } else if groupIndex < groups.count - 1 {
            groupIndex += 1
            storyIndex = 0
        } else {
            dismiss()
            return
        }
        startStory()
    }

    private func prev() {
        if storyIndex > 0 {
            storyIndex -= 1
        } else if groupIndex > 0 {
            groupIndex -= 1
            storyIndex = max(0, (groups[groupIndex].stories.count) - 1)
        }
        startStory() // at the very first story this just restarts it
    }

    private func markSeen(_ story: StoryItem) {
        guard !seenLocally.contains(story.id), !story.seen else {
            seenLocally.insert(story.id)
            return
        }
        seenLocally.insert(story.id)
        onSeen(story.id)
        Task { try? await API.markStoryViewed(story.id) }
    }
}

// MARK: - composer

// Compose + post a story (photo and/or caption) from the "＋ Your story" bubble.
// Reuses the shared ImageCropperView (square) and API.uploadStoryImage/addStory.
struct StoryComposerView: View {
    var onPosted: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @Environment(ToastCenter.self) private var toasts

    @State private var draft = ""
    @State private var photoItem: PhotosPickerItem?
    @State private var pendingCrop: PendingCrop?
    @State private var pendingImageData: Data?
    @State private var posting = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Share a photo or a thought. It disappears in 72 hours.")
                        .font(Theme.displayFont(15).italic())
                        .foregroundStyle(Theme.textMuted)

                    if let data = pendingImageData, let img = UIImage(data: data) {
                        ZStack(alignment: .topTrailing) {
                            Image(uiImage: img)
                                .resizable().scaledToFill()
                                .frame(maxWidth: .infinity)
                                .frame(height: 240)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                            Button { pendingImageData = nil } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.system(size: 22))
                                    .foregroundStyle(.white).shadow(radius: 2).padding(6)
                            }
                        }
                    }

                    TextField("say something… (optional if you add a photo)",
                              text: $draft, axis: .vertical)
                        .font(Theme.displayFont(17))
                        .lineLimit(2...5)

                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Label(pendingImageData == nil ? "add photo" : "change photo",
                              systemImage: "photo")
                            .font(Theme.monoFont(13))
                    }
                }
                .padding(16)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("＋ Your story")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Post") { submit() }
                        .disabled(posting ||
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
        }
    }

    private func submit() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !posting, !(text.isEmpty && pendingImageData == nil) else { return }
        posting = true
        Task {
            defer { posting = false }
            do {
                var imageUrl: String?
                if let data = pendingImageData {
                    imageUrl = try await API.uploadStoryImage(jpegData: data)
                }
                _ = try await API.addStory(body: text.isEmpty ? nil : text, imageUrl: imageUrl)
                toasts.show("Story posted", .success)
                onPosted()
                dismiss()
            } catch {
                toasts.error(error)
            }
        }
    }
}
