// The home tab: a social activity feed across every club you belong to (port
// of views/feed.js). The web's side rails become in-feed sections: an "Active
// clubs" strip up top and a "Currently reading" strip, with vote alerts
// between. The feed itself is derived ENTIRELY client-side from service-layer
// data - reactions arrive already spoiler-filtered by RLS; gating is never
// re-implemented here.

import SwiftUI
import Observation

// One club's snapshot for the feed (port of feed.js gatherClub()).
struct ClubSnapshot {
    let summary: ClubSummary
    let book: Book?
    let selections: [Selection]
    let reactions: [ReactionItem]
    let progress: [ProgressItem]
    let members: [Member]

    var club: Club { summary.club }
}

// A feed card. Ids are stable across reloads so SwiftUI keeps per-card state
// (open reply threads, composer drafts) alive through realtime refreshes.
// Every event carries `club` (header chip; nil = "Following") + `bookTitle`
// (its own line) instead of baking them into the sentence, and an `eventType`
// that drives its look (web parity: feed-kind-* classes).
struct FeedEvent: Identifiable {
    enum Kind {
        case reaction(ReactionItem)
        case notif(icon: String, text: String, highlight: Bool)
    }

    // progress = sage log entry · reaction = slate · milestone = rust ·
    // pick/vote = ochre · social (likes) = clay · follow = mauve
    enum EventType {
        case progress, reaction, milestone, pick, social, follow
    }

    let id: String
    let ts: Date
    let kind: Kind
    var eventType: EventType = .progress
    var club: String?
    var bookTitle: String?
    var isFollow: Bool = false
    var go: Route?
    var targetType: EngagementTarget?
    var targetId: UUID?
}

// Rotating literary quotes (port of feed.js QUOTES).
private struct LiteraryQuote {
    let text: String
    let author: String
    let work: String
    let year: Int
}

private let literaryQuotes: [LiteraryQuote] = [
    LiteraryQuote(text: "A reader lives a thousand lives before he dies. The man who never reads lives only one.", author: "George R.R. Martin", work: "A Dance with Dragons", year: 2011),
    LiteraryQuote(text: "Not all those who wander are lost.", author: "J.R.R. Tolkien", work: "The Fellowship of the Ring", year: 1954),
    LiteraryQuote(text: "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.", author: "Jane Austen", work: "Pride and Prejudice", year: 1813),
    LiteraryQuote(text: "All happy families are alike; each unhappy family is unhappy in its own way.", author: "Leo Tolstoy", work: "Anna Karenina", year: 1878),
    LiteraryQuote(text: "It was the best of times, it was the worst of times.", author: "Charles Dickens", work: "A Tale of Two Cities", year: 1859),
    LiteraryQuote(text: "The most courageous act is still to think for yourself. Aloud.", author: "Coco Chanel", work: "The Gospel According to Coco Chanel", year: 2009),
    LiteraryQuote(text: "We accept the love we think we deserve.", author: "Stephen Chbosky", work: "The Perks of Being a Wallflower", year: 1999),
    LiteraryQuote(text: "So it goes.", author: "Kurt Vonnegut", work: "Slaughterhouse-Five", year: 1969),
    LiteraryQuote(text: "The answer to the ultimate question of life, the universe, and everything is 42.", author: "Douglas Adams", work: "The Hitchhiker's Guide to the Galaxy", year: 1979),
    LiteraryQuote(text: "Why, sometimes I\u{2019}ve believed as many as six impossible things before breakfast.", author: "Lewis Carroll", work: "Through the Looking-Glass", year: 1871),
    LiteraryQuote(text: "There is no greater agony than bearing an untold story inside you.", author: "Maya Angelou", work: "I Know Why the Caged Bird Sings", year: 1969),
    LiteraryQuote(text: "One must always be careful of books, and what is inside them, for words have the power to change us.", author: "Cassandra Clare", work: "City of Bones", year: 2007),
    LiteraryQuote(text: "That\u{2019}s the thing about books. They let you travel without moving your feet.", author: "Jhumpa Lahiri", work: "The Namesake", year: 2003),
    LiteraryQuote(text: "I took a deep breath and listened to the old brag of my heart: I am, I am, I am.", author: "Sylvia Plath", work: "The Bell Jar", year: 1963),
    LiteraryQuote(text: "Until I feared I would lose it, I never loved to read. One does not love breathing.", author: "Harper Lee", work: "To Kill a Mockingbird", year: 1960),
    LiteraryQuote(text: "Time is a flat circle.", author: "Friedrich Nietzsche", work: "The Gay Science", year: 1882),
    LiteraryQuote(text: "It does not do to dwell on dreams and forget to live.", author: "J.K. Rowling", work: "Harry Potter and the Philosopher\u{2019}s Stone", year: 1997),
    LiteraryQuote(text: "We are all just walking each other home.", author: "Ram Dass", work: "Be Here Now", year: 1971),
]

/// Pick a quote by day-of-epoch so it changes daily but doesn't flicker.
private func todaysGreeting() -> LiteraryQuote {
    let day = Int(Date().timeIntervalSince1970) / 86400
    return literaryQuotes[day % literaryQuotes.count]
}

/// Count events from the last 24 hours as a lightweight "new activity" signal.
private func countRecentEvents(_ events: [FeedEvent]) -> Int {
    let cutoff = Date().addingTimeInterval(-86400)
    return events.filter { $0.ts > cutoff }.count
}

@MainActor
@Observable
final class FeedModel {
    var snapshots: [ClubSnapshot] = []
    var announcements: [Announcement] = []
    var stories: [StoryGroup] = []
    var events: [FeedEvent] = []
    var context: EngageContext = .empty
    var loading = true
    var loadError: String?

    @ObservationIgnored private let bag = RealtimeBag()
    @ObservationIgnored private var myId: UUID?

    func load() async {
        do {
            myId = try await API.currentUserId()
            let clubs = try await API.myClubs()

            // Readers I follow: their solo reading OUTSIDE my clubs (already
            // RLS-filtered). Items inside a shared club are dropped below —
            // the club events cover those.
            let myClubIds = Set(clubs.map(\.id))
            let followItems = ((try? await API.followFeed())?.items ?? [])
                .filter { item in item.book.map { !myClubIds.contains($0.clubId) } ?? false }

            // Active (unexpired, audience-visible) stories, grouped by author.
            // Already RLS-filtered; a failure just hides the strip.
            let activeStories = (try? await API.activeStories()) ?? []

            // One pass over my clubs, fetching everything the screen needs.
            var gathered: [ClubSnapshot] = []
            try await withThrowingTaskGroup(of: (Int, ClubSnapshot).self) { group in
                for (i, summary) in clubs.enumerated() {
                    group.addTask { (i, try await Self.gather(summary)) }
                }
                var indexed: [(Int, ClubSnapshot)] = []
                for try await item in group { indexed.append(item) }
                gathered = indexed.sorted { $0.0 < $1.0 }.map(\.1)
            }

            // Bulk-load reply threads, global announcements, and every
            // engagement on anything visible (three queries, not per-club).
            let reactionIds = gathered.flatMap { $0.reactions.map(\.id) }
            async let repliesReq = API.reactionReplies(reactionIds: reactionIds)
            async let annsReq = API.activeAnnouncements()
            let (replies, anns) = try await (repliesReq, annsReq)

            var targetIds = reactionIds
            targetIds += replies.map(\.id)
            targetIds += gathered.compactMap { $0.book?.id }
            targetIds += gathered.flatMap { $0.progress.map(\.id) }
            targetIds += gathered.flatMap { $0.selections.map(\.id) }
            targetIds += anns.map(\.id)
            let engagements = try await API.engagementsFor(targetIds: targetIds)

            var profiles: [UUID: Profile] = [:]
            for snap in gathered {
                for m in snap.members where m.profile != nil { profiles[m.userId] = m.profile }
                for r in snap.reactions where r.profile != nil { profiles[r.reaction.userId] = r.profile }
            }
            for r in replies where r.profile != nil { profiles[r.reply.userId] = r.profile }

            let ctx = EngageContext(myId: myId, engagements: engagements,
                                    replies: replies, profiles: profiles)

            snapshots = gathered
            announcements = anns
            stories = activeStories
            context = ctx
            events = (Self.buildEvents(snapshots: gathered, myId: myId)
                      + Self.buildFollowEvents(followItems)
                      + Self.buildLikeNotifications(snapshots: gathered,
                                                    replies: replies,
                                                    engagements: engagements,
                                                    context: ctx,
                                                    myId: myId))
                .sorted { $0.ts > $1.ts }
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
        loading = false
    }

    private static func gather(_ summary: ClubSummary) async throws -> ClubSnapshot {
        async let bookReq = API.currentBook(summary.id)
        async let selectionsReq = API.clubSelections(summary.id)
        let (book, selections) = try await (bookReq, selectionsReq)

        guard let book else {
            return ClubSnapshot(summary: summary, book: nil, selections: selections,
                                reactions: [], progress: [], members: [])
        }
        async let reactionsReq = API.bookReactions(book.id)
        async let progressReq = API.bookProgress(book.id)
        async let membersReq = API.clubMembers(summary.id)
        let (reactions, progress, members) = try await (reactionsReq, progressReq, membersReq)
        return ClubSnapshot(summary: summary, book: book, selections: selections,
                            reactions: reactions, progress: progress, members: members)
    }

    // Live refresh: any change re-runs the snapshot in place, debounced 400ms
    // like the web. Torn down in stopRealtime() (the onCleanup equivalent).
    func startRealtime() async {
        let reload: @MainActor () -> Void = { [weak self] in
            guard let self else { return }
            self.bag.schedule { await self.load() }
        }
        for (name, table) in [
            ("feed-reactions", "reactions"),
            ("feed-progress", "reading_progress"),
            ("feed-selections", "selections"),
            ("feed-engagements", "engagements"),
            ("feed-replies", "reaction_replies"),
            ("feed-announcements", "announcements"),
            ("feed-stories", "stories"),
            ("feed-story-views", "story_views"),
        ] {
            bag.add(await API.subscribe(channelName: name, table: table, onChange: reload))
        }
    }

    func stopRealtime() {
        bag.cancelAll()
    }

    // Optimistically flip a story's seen flag in the in-memory strip so the ring
    // dims immediately as the viewer plays it (the realtime story_views sub also
    // triggers a full reload shortly after, which reconciles).
    func markStorySeenLocally(_ storyId: UUID) {
        for gi in stories.indices {
            for si in stories[gi].stories.indices where stories[gi].stories[si].id == storyId {
                stories[gi].stories[si].seen = true
            }
        }
    }

    // MARK: event derivation (port of feed.js buildEvents)

    private static func buildEvents(snapshots: [ClubSnapshot], myId: UUID?) -> [FeedEvent] {
        var events: [FeedEvent] = []

        for snap in snapshots {
            let club = snap.club

            if let book = snap.book {
                let bookRoute = Route.book(clubId: club.id, bookId: book.id)

                events.append(FeedEvent(
                    id: "book-\(book.id)", ts: book.createdAt,
                    kind: .notif(icon: "\u{1F4DA}",
                                 text: "The club started a new book",
                                 highlight: false),
                    eventType: .milestone, club: club.name, bookTitle: book.title,
                    go: bookRoute, targetType: .book, targetId: book.id))

                for r in snap.reactions {
                    events.append(FeedEvent(
                        id: r.id.uuidString, ts: r.reaction.createdAt,
                        kind: .reaction(r),
                        eventType: .reaction, club: club.name, bookTitle: book.title,
                        go: bookRoute))
                }

                for p in snap.progress {
                    let name = p.progress.userId == myId ? "You" : (p.profile?.displayName ?? "A reader")
                    switch p.progress.status {
                    case .finished:
                        events.append(FeedEvent(
                            id: "progress-\(p.id)", ts: p.progress.finishedAt ?? p.progress.updatedAt,
                            kind: .notif(icon: "\u{1F389}",
                                         text: "\(name) finished the book",
                                         highlight: false),
                            eventType: .milestone, club: club.name, bookTitle: book.title,
                            go: bookRoute, targetType: .progress, targetId: p.id))
                    case .reading where p.progress.currentPage > 0:
                        let of = book.pageCount.map { " of \($0)" } ?? ""
                        events.append(FeedEvent(
                            id: "progress-\(p.id)", ts: p.progress.updatedAt,
                            kind: .notif(icon: "\u{1F4D6}",
                                         text: "\(name) read to page \(p.progress.currentPage)\(of)",
                                         highlight: false),
                            eventType: .progress, club: club.name, bookTitle: book.title,
                            go: bookRoute, targetType: .progress, targetId: p.id))
                    case .reading, .notStarted:
                        if p.progress.status == .reading || p.progress.startedAt != nil {
                            events.append(FeedEvent(
                                id: "progress-\(p.id)", ts: p.progress.startedAt ?? p.progress.updatedAt,
                                kind: .notif(icon: "\u{1F516}",
                                             text: "\(name) started reading",
                                             highlight: false),
                                eventType: .progress, club: club.name, bookTitle: book.title,
                                go: bookRoute, targetType: .progress, targetId: p.id))
                        }
                    }
                }

                let finished = snap.progress.filter { $0.progress.status == .finished }
                if !snap.members.isEmpty && finished.count >= snap.members.count {
                    let last = finished
                        .map { $0.progress.finishedAt ?? $0.progress.updatedAt }
                        .max() ?? book.createdAt
                    events.append(FeedEvent(
                        id: "trophy-\(book.id)", ts: last,
                        kind: .notif(icon: "\u{1F3C6}",
                                     text: "Everyone finished the book!",
                                     highlight: true),
                        eventType: .milestone, club: club.name, bookTitle: book.title,
                        go: bookRoute))
                }
            }

            for s in snap.selections {
                switch s.status {
                case .open:
                    events.append(FeedEvent(
                        id: "selopen-\(s.id)", ts: s.createdAt,
                        kind: .notif(icon: "\u{1F5F3}\u{FE0F}",
                                     text: "A vote opened - pick who chooses next",
                                     highlight: true),
                        eventType: .pick, club: club.name,
                        go: .picker(clubId: club.id), targetType: .selection, targetId: s.id))
                case .decided:
                    let winner = snap.members.first { $0.userId == s.resultUser }?.profile?.displayName
                    let text = winner.map { "\($0) will pick the next book" }
                        ?? "The club decided who picks next"
                    events.append(FeedEvent(
                        id: "seldec-\(s.id)", ts: s.decidedAt ?? s.createdAt,
                        kind: .notif(icon: "\u{1F3AF}", text: text, highlight: false),
                        eventType: .pick, club: club.name,
                        go: .history(clubId: club.id), targetType: .selection, targetId: s.id))
                }
            }
        }
        return events
    }

    // Follow-feed items: solo reading by people I follow, outside my clubs.
    // They carry a "Following" header chip (club == nil) and tap through to the
    // reader's profile - their book lives in a club we're not a member of.
    private static func buildFollowEvents(_ items: [FollowFeedItem]) -> [FeedEvent] {
        items.compactMap { item in
            guard let book = item.book else { return nil }
            let go = item.profile.map { Route.reader($0.id) }
            switch item.kind {
            case .reaction:
                let reaction = Reaction(id: item.id, bookId: book.id,
                                        userId: item.profile?.id ?? UUID(),
                                        page: item.page, body: item.body ?? "",
                                        createdAt: item.at)
                return FeedEvent(
                    id: "follow-\(item.id)", ts: item.at,
                    kind: .reaction(ReactionItem(reaction: reaction, profile: item.profile)),
                    eventType: .follow, club: nil, bookTitle: book.title,
                    isFollow: true, go: go)
            case .progress:
                let name = item.profile?.displayName ?? "A reader"
                let of = book.pageCount.map { " of \($0)" } ?? ""
                let (icon, text): (String, String) =
                    item.status == .finished ? ("\u{1F389}", "\(name) finished the book")
                    : item.page > 0 ? ("\u{1F4D6}", "\(name) read to page \(item.page)\(of)")
                    : ("\u{1F516}", "\(name) started reading")
                return FeedEvent(
                    id: "follow-\(item.id)", ts: item.at,
                    kind: .notif(icon: icon, text: text, highlight: false),
                    eventType: .follow, club: nil, bookTitle: book.title,
                    isFollow: true, go: go)
            }
        }
    }

    // "Someone liked your X" cards, derived from likes others left on my stuff
    // (port of feed.js buildLikeNotifications).
    private static func buildLikeNotifications(snapshots: [ClubSnapshot],
                                               replies: [ReplyItem],
                                               engagements: [Engagement],
                                               context: EngageContext,
                                               myId: UUID?) -> [FeedEvent] {
        guard let myId else { return [] }

        var likesByTarget: [UUID: [Engagement]] = [:]
        for e in engagements where e.kind == EngagementKind.like && e.userId != myId {
            likesByTarget[e.targetId, default: []].append(e)
        }

        // Things I authored, with a human label for the notification and the
        // club it happened in (for the card's header chip).
        var mine: [(id: UUID, label: String, club: String?, book: String?)] = []
        var clubByReaction: [UUID: String] = [:]
        for snap in snapshots {
            for r in snap.reactions { clubByReaction[r.id] = snap.club.name }
            if let book = snap.book, book.pickedBy == myId {
                mine.append((book.id, "your pick", snap.club.name, book.title))
            }
            for r in snap.reactions where r.reaction.userId == myId {
                mine.append((r.id, "your reaction", snap.club.name, snap.book?.title))
            }
            for p in snap.progress where p.progress.userId == myId {
                mine.append((p.id, "your reading update", snap.club.name, snap.book?.title))
            }
        }
        for r in replies where r.reply.userId == myId {
            mine.append((r.id, "your reply", clubByReaction[r.reply.reactionId], nil))
        }

        var events: [FeedEvent] = []
        for item in mine {
            guard let likes = likesByTarget[item.id], !likes.isEmpty else { continue }
            let names = likes.map { context.name(of: $0.userId) }
            let ts = likes.map(\.createdAt).max() ?? Date()
            events.append(FeedEvent(
                id: "likes-\(item.id)", ts: ts,
                kind: .notif(icon: "\u{1F44D}",
                             text: "\(likeLabel(names)) liked \(item.label)",
                             highlight: false),
                eventType: .social, club: item.club, bookTitle: item.book))
        }
        return events
    }

    private static func likeLabel(_ names: [String]) -> String {
        switch names.count {
        case 1: return names[0]
        case 2: return "\(names[0]) and \(names[1])"
        default: return "\(names[0]) (and \(names.count - 1) others)"
        }
    }
}

// MARK: - the screen

struct FeedView: View {
    // The center tab-bar "+" (RootView) drives this: each increment asks the
    // feed to open its compose hub. Defaults to a constant so FeedView still
    // works standalone (previews / any other embedding).
    var composeSignal: Int = 0

    @Environment(SessionStore.self) private var session
    @Environment(ToastCenter.self) private var toasts
    @State private var model = FeedModel()
    @State private var showCreateClub = false
    @State private var showJoinClub = false
    @State private var broadcastDraft = ""
    @State private var viewerStart: Int?      // group index the story viewer opens on
    @State private var showComposer = false   // story composer (shared with the strip bubble)

    // Compose hub ("+"): the action menu + its destinations.
    @State private var showComposeMenu = false
    @State private var showPostComposer = false
    @State private var showBookClubPicker = false
    @State private var bookClub: ClubSummary?   // chosen club for "Start a book"

    // My clubs, from the loaded snapshots — feeds the post multi-select and the
    // start-a-book club picker without a second fetch.
    private var myClubs: [ClubSummary] { model.snapshots.map(\.summary) }
    // Only clubs I own can have their current book set (books insert/update is
    // owner-gated server-side), so the start-a-book flow offers just those.
    private var ownedClubs: [ClubSummary] { myClubs.filter { $0.myRole.isOwnerTier } }

    var body: some View {
        Group {
            if model.loading && model.snapshots.isEmpty {
                loadingView("loading your feed\u{2026}")
            } else if let err = model.loadError, model.snapshots.isEmpty {
                ScrollView {
                    LoadErrorView(message: err) { await model.load() }
                        .padding(16)
                }
            } else {
                feedList
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle("Your Feed")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    Button("Join with code", systemImage: "number") { showJoinClub = true }
                        .font(Theme.monoMedium(15))
                    Button("New club", systemImage: "plus") { showCreateClub = true }
                        .font(Theme.monoMedium(15))
                } label: {
                    Image(systemName: "person.2")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showComposeMenu = true } label: {
                    Image(systemName: "plus.circle.fill")
                }
                .accessibilityLabel("Create")
            }
        }
        .confirmationDialog("Create", isPresented: $showComposeMenu, titleVisibility: .visible) {
            Button("Create post") { showPostComposer = true }
            Button("Post a story") { showComposer = true }
            Button("Start a book") { startBook() }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(isPresented: $showCreateClub) { CreateClubSheet() }
        .sheet(isPresented: $showJoinClub) { JoinClubSheet() }
        .sheet(isPresented: $showComposer) {
            StoryComposerView { Task { await model.load() } }
        }
        .sheet(isPresented: $showPostComposer) {
            MultiClubPostComposerView(clubs: myClubs) { Task { await model.load() } }
        }
        // "Start a book": if I own exactly one club we skip the picker and jump
        // straight to that club's book search; otherwise pick a club first.
        .sheet(isPresented: $showBookClubPicker) {
            BookClubPickerSheet(clubs: ownedClubs) { chosen in
                // Dismiss the picker first, then present the book search once it's
                // gone — presenting a new sheet mid-dismissal can drop the second.
                showBookClubPicker = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { bookClub = chosen }
            }
        }
        .sheet(item: $bookClub) { summary in
            AddBookSheet(club: summary.club) { _ in Task { await model.load() } }
        }
        .fullScreenCover(item: Binding(
            get: { viewerStart.map { StartIndex(value: $0) } },
            set: { viewerStart = $0?.value }
        )) { start in
            StoryViewerView(groups: model.stories, groupIndex: start.value) { id in
                model.markStorySeenLocally(id)
            }
        }
        .task {
            await model.load()
            await model.startRealtime()
        }
        .onChange(of: composeSignal) { _, _ in showComposeMenu = true }
        .onDisappear { model.stopRealtime() }
        .refreshable { await model.load() }
    }

    // "Start a book": route to a book search for a club I own. Zero → toast,
    // one → straight to the search, many → pick which club first.
    private func startBook() {
        switch ownedClubs.count {
        case 0: toasts.show("Only a club's owner can set its book")
        case 1: bookClub = ownedClubs.first
        default: showBookClubPicker = true
        }
    }

    // The Feed tab is strictly the feed: global announcements + the activity
    // stream. "Active clubs" lives in the Clubs tab and "Currently reading" in
    // the My Progress tab, so those web-side rails are intentionally omitted
    // here (open votes still surface as feed cards via buildEvents).
    private var feedList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                storiesStrip
                greetingHeader
                announcementsSection
                feedStream
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: stories strip

    // The ephemeral-stories strip above the greeting. Groups came back already
    // RLS-filtered + grouped by author from API.activeStories(). My own bubble
    // is pinned first as "＋ Your story" (tap to compose, or view my live
    // stories); other bubbles wear a yarn-accent ring when unseen, dimmed when
    // all seen. Tapping opens the full-screen viewer at that author.
    @ViewBuilder
    private var storiesStrip: some View {
        let mine = model.stories.first { $0.isMine }
        let others = model.stories.filter { !$0.isMine }
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 14) {
                myStoryBubble(mine)
                ForEach(others) { group in
                    storyBubble(group) {
                        viewerStart = model.stories.firstIndex(of: group) ?? 0
                    }
                }
            }
            .padding(.vertical, 4)
        }
    }

    @ViewBuilder
    private func myStoryBubble(_ mine: StoryGroup?) -> some View {
        if let mine {
            // I have live stories: view them, with a + badge to add more.
            storyBubble(mine, isMine: true) {
                viewerStart = model.stories.firstIndex(of: mine) ?? 0
            }
        } else {
            Button { showComposer = true } label: {
                VStack(spacing: 5) {
                    ZStack {
                        Circle().fill(Theme.surface2)
                            .frame(width: 62, height: 62)
                            .overlay(Circle().stroke(Theme.yarnSage, lineWidth: 3))
                        Text("＋").font(.system(size: 26, weight: .bold))
                            .foregroundStyle(Theme.yarnSage)
                    }
                    Text("Your story")
                        .font(Theme.monoFont(10))
                        .foregroundStyle(Theme.textMuted)
                        .lineLimit(1)
                }
                .frame(width: 74)
            }
            .buttonStyle(.plain)
        }
    }

    private func storyBubble(_ group: StoryGroup, isMine: Bool = false,
                             action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 5) {
                ZStack(alignment: .bottomTrailing) {
                    AvatarView(profile: group.profile, size: 58)
                        .padding(3)
                        .overlay(
                            Circle().stroke(group.allSeen
                                            ? Theme.textMuted.opacity(0.5)
                                            : Theme.yarnRust,
                                            lineWidth: 3))
                        .opacity(group.allSeen ? 0.75 : 1)
                    if isMine {
                        Text("＋")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.surface)
                            .frame(width: 20, height: 20)
                            .background(Circle().fill(Theme.yarnSage))
                            .overlay(Circle().stroke(Theme.bg, lineWidth: 2))
                    }
                }
                Text(isMine ? "Your story" : group.displayName)
                    .font(Theme.monoFont(10))
                    .foregroundStyle(Theme.textMuted)
                    .lineLimit(1)
            }
            .frame(width: 74)
        }
        .buttonStyle(.plain)
    }

    // MARK: greeting header

    // A welcome mat: centered, roughly the top quarter of the screen, before
    // the stream starts (web parity with the phone-width greeting).
    private var greetingHeader: some View {
        VStack(spacing: 0) {
            VStack(spacing: 14) {
                let quote = todaysGreeting()
                Text(quote.text)
                    .font(Theme.displayFont(26).italic())
                    .foregroundStyle(Theme.textPrimary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

                Text("— \(quote.author), \(quote.work) (\(quote.year))")
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

                let recentCount = countRecentEvents(model.events)
                if recentCount > 0 {
                    Text("\(recentCount) new")
                        .font(Theme.monoFont(11))
                        .foregroundStyle(Theme.surface)
                        .padding(.vertical, 3)
                        .padding(.horizontal, 9)
                        .background(Capsule().fill(Theme.yarnRust))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider()
                .overlay(Theme.yarnClay.opacity(0.6))
        }
        .containerRelativeFrame(.vertical, count: 4, span: 1, spacing: 0)
        .padding(.bottom, 4)
    }

    // MARK: announcements (+ admin composer)

    @ViewBuilder
    private var announcementsSection: some View {
        if session.isAdmin {
            VStack(alignment: .leading, spacing: 8) {
                Text("\u{1F4E3} Broadcast to everyone")
                    .font(Theme.displaySemiBold(15))
                TextField("e.g. You can now respond to people's reactions!",
                          text: $broadcastDraft, axis: .vertical)
                    .font(Theme.displayFont(15))
                    .lineLimit(2...4)
                    .padding(8)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Theme.surface2))
                Button("Send to all users") { sendBroadcast() }
                    .buttonStyle(.primarySmall)
                    .disabled(broadcastDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .patch(accent: Theme.yarnOchre, seed: "broadcast")
        }

        ForEach(model.announcements) { ann in
            HStack(alignment: .top, spacing: 10) {
                Text("\u{1F4E3}").font(.system(size: 18))
                VStack(alignment: .leading, spacing: 6) {
                    Text(ann.body)
                        .font(Theme.displayFont(16))
                        .foregroundStyle(Theme.textPrimary)
                    EngagementBar(targetType: .announcement, targetId: ann.id,
                                  context: model.context) {
                        await model.load()
                    }
                }
                Spacer()
                Button {
                    dismissAnnouncement(ann)
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Dismiss announcement")
            }
            .patch(accent: Theme.yarnOchre, seed: ann.id.uuidString)
        }
    }

    // MARK: the stream

    @ViewBuilder
    private var feedStream: some View {
        if model.events.isEmpty {
            EmptyStateView(
                title: "your feed is quiet.",
                hint: "join or create a club, set a book, and activity from every club you're in will show up here."
            )
        } else {
            ForEach(model.events) { event in
                eventCard(event)
            }
        }
    }

    @ViewBuilder
    private func eventCard(_ event: FeedEvent) -> some View {
        switch event.kind {
        case .reaction(let item):
            reactionCard(event: event, item: item)
        case .notif(let icon, let text, let highlight):
            notifCard(event: event, icon: icon, text: text, highlight: highlight)
        }
    }

    // The yarn accent each event type wears (web parity: feed-kind-* colors).
    private func accent(for event: FeedEvent, highlight: Bool = false) -> Color {
        if highlight { return Theme.yarnOchre }
        switch event.eventType {
        case .progress: return Theme.yarnSage
        case .reaction: return Theme.yarnSlate
        case .milestone: return Theme.yarnRust
        case .pick: return Theme.yarnOchre
        case .social: return Theme.yarnClay
        case .follow: return Theme.yarnMauve
        }
    }

    // The small header every card carries: which club this happened in — or
    // "Following" when it comes from a reader you follow outside your clubs —
    // with the book it's about right underneath.
    private func cardHead(_ event: FeedEvent) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(event.club ?? "\u{2727} Following")
                    .font(Theme.monoFont(10))
                    .kerning(1.2)
                    .textCase(.uppercase)
                    .foregroundStyle(event.club == nil ? Theme.yarnMauve : Theme.yarnBark)
                    .lineLimit(1)
                    .padding(.vertical, 2)
                    .padding(.horizontal, 9)
                    .background(
                        Capsule().fill((event.club == nil ? Theme.yarnMauve : Theme.yarnBark).opacity(0.10)))
                    .overlay(
                        Capsule().stroke((event.club == nil ? Theme.yarnMauve : Theme.yarnBark).opacity(0.45),
                                         lineWidth: 1.5))
                Spacer()
                Text(Format.timeAgo(event.ts))
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
            }
            bookLine(event)
        }
    }

    // The book a card is about — its own line, out of the sentence.
    @ViewBuilder
    private func bookLine(_ event: FeedEvent) -> some View {
        if let title = event.bookTitle {
            Text(title)
                .font(Theme.displayFont(14).italic())
                .foregroundStyle(Theme.yarnRust)
                .lineLimit(1)
        }
    }

    private func reactionCard(event: FeedEvent, item: ReactionItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            cardHead(event)
            // The author chip links to their profile; the body still links to
            // the book (or the reader for follow items). Two separate links, so
            // the header sits OUTSIDE the card-level navigable.
            HStack(spacing: 8) {
                ReaderLink(userId: item.reaction.userId) {
                    HStack(spacing: 8) {
                        AvatarView(profile: item.profile, size: 30)
                        Text(item.profile?.displayName ?? "Reader")
                            .font(Theme.monoMedium(13))
                            .foregroundStyle(Theme.textPrimary)
                    }
                }
                Spacer()
                pageTag(item.reaction.page)
            }
            navigable(event.go) {
                Text(item.reaction.body)
                    .font(Theme.displayFont(16))
                    .foregroundStyle(Theme.textPrimary)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            // Follow-path reactions are display-only — they live in clubs we're
            // not members of, so no engagement bar or reply thread.
            if !event.isFollow {
                EngagementBar(targetType: .reaction, targetId: item.id, context: model.context) {
                    await model.load()
                }
                ReplyThreadView(reactionId: item.id, context: model.context) {
                    await model.load()
                }
            }
        }
        .patch(accent: accent(for: event), seed: event.id)
    }

    private func notifCard(event: FeedEvent, icon: String, text: String, highlight: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            cardHead(event)
            navigable(event.go) {
                HStack(alignment: .top, spacing: 10) {
                    Text(icon).font(.system(size: 18))
                    VStack(alignment: .leading, spacing: 4) {
                        // Read updates read like little log entries (mono), the
                        // rest keep the display face; milestones sit bolder.
                        Text(text)
                            .font(event.eventType == .progress
                                  ? Theme.monoFont(13)
                                  : event.eventType == .milestone || event.eventType == .pick
                                    ? Theme.displaySemiBold(15)
                                    : Theme.displayFont(15))
                            .foregroundStyle(event.eventType == .social ? Theme.textMuted : Theme.textPrimary)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 0)
                }
            }
            if !event.isFollow, let type = event.targetType, let id = event.targetId {
                EngagementBar(targetType: type, targetId: id, context: model.context) {
                    await model.load()
                }
            }
        }
        .patch(accent: accent(for: event, highlight: highlight),
               seed: event.id, padding: 12)
    }

    // Wrap content in a NavigationLink when the card has somewhere to go.
    @ViewBuilder
    private func navigable<Content: View>(_ route: Route?, @ViewBuilder content: () -> Content) -> some View {
        if let route {
            NavigationLink(value: route) { content() }
                .buttonStyle(.plain)
        } else {
            content()
        }
    }

    private func pageTag(_ page: Int) -> some View {
        Text("p.\(page)")
            .font(Theme.monoMedium(11))
            .foregroundStyle(.white)
            .padding(.vertical, 2)
            .padding(.horizontal, 6)
            .background(Capsule().fill(Theme.yarnSlate))
    }

    private func loadingView(_ text: String) -> some View {
        VStack(spacing: 10) {
            ProgressView().tint(Theme.yarnSage)
            Text(text)
                .font(Theme.displayFont(15))
                .foregroundStyle(Theme.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: actions

    private func sendBroadcast() {
        let body = broadcastDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        Task {
            do {
                try await API.postAnnouncement(body: body)
                broadcastDraft = ""
                toasts.show("Broadcast sent to all users", .success)
                await model.load()
            } catch {
                toasts.error(error)
            }
        }
    }

    private func dismissAnnouncement(_ ann: Announcement) {
        Task {
            do {
                try await API.dismissAnnouncement(ann.id)
                await model.load()
            } catch {
                toasts.error(error)
            }
        }
    }
}

// Identifiable wrapper so an Int group-index can drive a fullScreenCover(item:).
private struct StartIndex: Identifiable {
    let value: Int
    var id: Int { value }
}

// The compose hub's "Start a book" step when I own more than one club: pick
// which club's current book to set, then the caller hands off to AddBookSheet.
private struct BookClubPickerSheet: View {
    let clubs: [ClubSummary]
    var onPick: (ClubSummary) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(clubs) { summary in
                    Button { onPick(summary) } label: {
                        HStack(spacing: 10) {
                            ClubAvatarView(club: summary.club, size: 32)
                            Text(summary.club.name)
                                .font(Theme.displaySemiBold(16))
                                .foregroundStyle(Theme.textPrimary)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Start a book in\u{2026}")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
