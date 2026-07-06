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
struct FeedEvent: Identifiable {
    enum Kind {
        case reaction(ReactionItem, context: String)
        case notif(icon: String, text: String, highlight: Bool)
    }

    let id: String
    let ts: Date
    let kind: Kind
    var go: Route?
    var targetType: EngagementTarget?
    var targetId: UUID?
}

// Rotating greeting phrases (port of feed.js GREETINGS).
private let greetingLines = [
    "Any new plot twists?",
    "What are you reading lately?",
    "Who\u{2019}s ahead on the reading?",
    "Got strong opinions about chapter 7?",
    "Someone\u{2019}s been busy turning pages.",
    "The club awaits your thoughts.",
    "Anything worth dog-earing?",
    "Still haunted by that last chapter?",
]

/// Pick a greeting by day-of-year so it changes daily but doesn't flicker.
private func todaysGreeting() -> String {
    let day = Int(Date().timeIntervalSince1970) / 86400
    return greetingLines[day % greetingLines.count]
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
            context = ctx
            events = (Self.buildEvents(snapshots: gathered, myId: myId)
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
        ] {
            bag.add(await API.subscribe(channelName: name, table: table, onChange: reload))
        }
    }

    func stopRealtime() {
        bag.cancelAll()
    }

    // MARK: event derivation (port of feed.js buildEvents)

    private static func buildEvents(snapshots: [ClubSnapshot], myId: UUID?) -> [FeedEvent] {
        var events: [FeedEvent] = []

        for snap in snapshots {
            let club = snap.club

            if let book = snap.book {
                let context = "\(book.title) \u{00B7} \(club.name)"
                let bookRoute = Route.book(clubId: club.id, bookId: book.id)

                events.append(FeedEvent(
                    id: "book-\(book.id)", ts: book.createdAt,
                    kind: .notif(icon: "\u{1F4DA}",
                                 text: "\(club.name) started reading \(book.title)",
                                 highlight: false),
                    go: bookRoute, targetType: .book, targetId: book.id))

                for r in snap.reactions {
                    events.append(FeedEvent(
                        id: r.id.uuidString, ts: r.reaction.createdAt,
                        kind: .reaction(r, context: context),
                        go: bookRoute))
                }

                for p in snap.progress {
                    let name = p.progress.userId == myId ? "You" : (p.profile?.displayName ?? "A reader")
                    switch p.progress.status {
                    case .finished:
                        events.append(FeedEvent(
                            id: "progress-\(p.id)", ts: p.progress.finishedAt ?? p.progress.updatedAt,
                            kind: .notif(icon: "\u{1F389}",
                                         text: "\(name) finished \(book.title)",
                                         highlight: false),
                            go: bookRoute, targetType: .progress, targetId: p.id))
                    case .reading where p.progress.currentPage > 0:
                        let of = book.pageCount.map { " of \($0)" } ?? ""
                        events.append(FeedEvent(
                            id: "progress-\(p.id)", ts: p.progress.updatedAt,
                            kind: .notif(icon: "\u{1F4D6}",
                                         text: "\(name) read to page \(p.progress.currentPage)\(of) of \(book.title)",
                                         highlight: false),
                            go: bookRoute, targetType: .progress, targetId: p.id))
                    case .reading, .notStarted:
                        if p.progress.status == .reading || p.progress.startedAt != nil {
                            events.append(FeedEvent(
                                id: "progress-\(p.id)", ts: p.progress.startedAt ?? p.progress.updatedAt,
                                kind: .notif(icon: "\u{1F516}",
                                             text: "\(name) started \(book.title)",
                                             highlight: false),
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
                                     text: "Everyone in \(club.name) finished \(book.title)!",
                                     highlight: true),
                        go: bookRoute))
                }
            }

            for s in snap.selections {
                switch s.status {
                case .open:
                    events.append(FeedEvent(
                        id: "selopen-\(s.id)", ts: s.createdAt,
                        kind: .notif(icon: "\u{1F5F3}\u{FE0F}",
                                     text: "A vote opened in \(club.name) - pick who chooses next",
                                     highlight: true),
                        go: .picker(clubId: club.id), targetType: .selection, targetId: s.id))
                case .decided:
                    let winner = snap.members.first { $0.userId == s.resultUser }?.profile?.displayName
                    let text = winner.map { "\($0) will pick the next book for \(club.name)" }
                        ?? "\(club.name) decided who picks next"
                    events.append(FeedEvent(
                        id: "seldec-\(s.id)", ts: s.decidedAt ?? s.createdAt,
                        kind: .notif(icon: "\u{1F3AF}", text: text, highlight: false),
                        go: .history(clubId: club.id), targetType: .selection, targetId: s.id))
                }
            }
        }
        return events
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

        // Things I authored, with a human label for the notification.
        var mine: [(id: UUID, label: String)] = []
        for snap in snapshots {
            if let book = snap.book, book.pickedBy == myId {
                mine.append((book.id, "your pick - \(book.title)"))
            }
            for r in snap.reactions where r.reaction.userId == myId {
                mine.append((r.id, "your reaction on \(snap.book?.title ?? snap.club.name)"))
            }
            for p in snap.progress where p.progress.userId == myId {
                mine.append((p.id, "your reading update"))
            }
        }
        for r in replies where r.reply.userId == myId {
            mine.append((r.id, "your reply"))
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
                             highlight: false)))
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
    @Environment(SessionStore.self) private var session
    @Environment(ToastCenter.self) private var toasts
    @State private var model = FeedModel()
    @State private var showCreateClub = false
    @State private var showJoinClub = false
    @State private var broadcastDraft = ""

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
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Join with code", systemImage: "number") { showJoinClub = true }
                    Button("New club", systemImage: "plus") { showCreateClub = true }
                } label: {
                    Image(systemName: "plus.circle")
                }
            }
        }
        .sheet(isPresented: $showCreateClub) { CreateClubSheet() }
        .sheet(isPresented: $showJoinClub) { JoinClubSheet() }
        .task {
            await model.load()
            await model.startRealtime()
        }
        .onDisappear { model.stopRealtime() }
        .refreshable { await model.load() }
    }

    // The Feed tab is strictly the feed: global announcements + the activity
    // stream. "Active clubs" lives in the Clubs tab and "Currently reading" in
    // the My Progress tab, so those web-side rails are intentionally omitted
    // here (open votes still surface as feed cards via buildEvents).
    private var feedList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                greetingHeader
                announcementsSection
                feedStream
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: greeting header

    private var greetingHeader: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(todaysGreeting())
                    .font(Theme.displayFont(20).italic())
                    .foregroundStyle(Theme.textPrimary)
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
            Divider()
                .overlay(Theme.yarnClay.opacity(0.6))
                .padding(.top, 10)
        }
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
        case .reaction(let item, let context):
            reactionCard(event: event, item: item, contextLine: context)
        case .notif(let icon, let text, let highlight):
            notifCard(event: event, icon: icon, text: text, highlight: highlight)
        }
    }

    private func reactionCard(event: FeedEvent, item: ReactionItem, contextLine: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            navigable(event.go) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        AvatarView(profile: item.profile, size: 30)
                        Text(item.profile?.displayName ?? "Reader")
                            .font(Theme.monoMedium(13))
                            .foregroundStyle(Theme.textPrimary)
                        Text(contextLine)
                            .font(Theme.monoFont(11))
                            .foregroundStyle(Theme.textMuted)
                            .lineLimit(1)
                        Spacer()
                        pageTag(item.reaction.page)
                    }
                    Text(item.reaction.body)
                        .font(Theme.displayFont(16))
                        .foregroundStyle(Theme.textPrimary)
                    Text(Format.timeAgo(item.reaction.createdAt))
                        .font(Theme.monoFont(11))
                        .foregroundStyle(Theme.textMuted)
                }
            }
            EngagementBar(targetType: .reaction, targetId: item.id, context: model.context) {
                await model.load()
            }
            ReplyThreadView(reactionId: item.id, context: model.context) {
                await model.load()
            }
        }
        .patch(seed: event.id)
    }

    private func notifCard(event: FeedEvent, icon: String, text: String, highlight: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            navigable(event.go) {
                HStack(alignment: .top, spacing: 10) {
                    Text(icon).font(.system(size: 18))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(text)
                            .font(Theme.displayFont(15))
                            .foregroundStyle(Theme.textPrimary)
                            .multilineTextAlignment(.leading)
                        Text(Format.timeAgo(event.ts))
                            .font(Theme.monoFont(11))
                            .foregroundStyle(Theme.textMuted)
                    }
                    Spacer(minLength: 0)
                }
            }
            if let type = event.targetType, let id = event.targetId {
                EngagementBar(targetType: type, targetId: id, context: model.context) {
                    await model.load()
                }
            }
        }
        .patch(accent: highlight ? Theme.yarnOchre : Theme.yarnBark,
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
