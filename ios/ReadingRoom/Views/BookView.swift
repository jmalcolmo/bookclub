// Book detail (port of views/book.js): the spoiler-gated reaction feed with
// reply threads and tapbacks, my-progress panel, page-tagged reaction
// composer with the reaction-to-progress sync prompt, reviews (unlock when I
// finish), and creator admin (edit deadline / finish book for the club).
// Reactions arrive already filtered by RLS - the gate lives server-side only.

import SwiftUI
import Observation

@MainActor
@Observable
final class BookModel {
    let clubId: UUID
    let bookId: UUID

    var book: Book?
    var mine: ReadingProgress?
    var myReview: Review?
    var reviews: [ReviewItem] = []
    var membership: ClubMember?
    var feed: [FeedEvent] = []
    var context: EngageContext = .empty
    var reactionCount = 0
    var loading = true
    var loadError: String?

    @ObservationIgnored private let bag = RealtimeBag()

    init(clubId: UUID, bookId: UUID) {
        self.clubId = clubId
        self.bookId = bookId
    }

    var myPage: Int { mine?.currentPage ?? 0 }
    var finished: Bool { mine?.status == .finished }

    // "started" once any progress is logged - drives the redundant
    // "mark started" button's visibility, like the web.
    var hasStarted: Bool {
        guard let mine else { return false }
        return mine.status == .reading || mine.status == .finished || mine.currentPage > 0
    }

    var isCreator: Bool { membership?.role.isOwnerTier ?? false }

    func load() async {
        do {
            let book = try await API.getBook(bookId)
            async let mineReq = API.myProgress(bookId: bookId)
            async let reviewsReq = API.bookReviews(bookId)   // RLS gates rows
            async let myReviewReq = API.myReview(bookId: bookId)
            async let membershipReq = API.myMembership(clubId: clubId)
            let (mine, reviews, myReview, membership) =
                try await (mineReq, reviewsReq, myReviewReq, membershipReq)
            self.book = book
            self.mine = mine
            self.reviews = reviews
            self.myReview = myReview
            self.membership = membership
            loadError = nil
            await loadFeed()
        } catch {
            loadError = error.localizedDescription
        }
        loading = false
    }

    // The merged, newest-first feed: spoiler-safe reactions interleaved with
    // per-member activity notifications (port of loadFeed + buildNotifications).
    func loadFeed() async {
        guard let book else { return }
        do {
            async let reactionsReq = API.bookReactions(book.id)
            async let progressReq = API.bookProgress(book.id)
            async let membersReq = API.clubMembers(clubId)
            let (reactions, progress, members) = try await (reactionsReq, progressReq, membersReq)

            let reactionIds = reactions.map(\.id)
            let replies = try await API.reactionReplies(reactionIds: reactionIds)

            let myId = try? await API.currentUserId()
            var events: [FeedEvent] = reactions.map {
                FeedEvent(id: $0.id.uuidString, ts: $0.reaction.createdAt,
                          kind: .reaction($0, context: ""))
            }
            events += Self.buildNotifications(progress: progress,
                                              memberCount: members.count,
                                              book: book,
                                              myId: myId)

            var targetIds = reactionIds
            targetIds += replies.map(\.id)
            targetIds += events.compactMap(\.targetId)
            let engagements = try await API.engagementsFor(targetIds: targetIds)

            var profiles: [UUID: Profile] = [:]
            for m in members where m.profile != nil { profiles[m.userId] = m.profile }
            for r in replies where r.profile != nil { profiles[r.reply.userId] = r.profile }
            for r in reactions where r.profile != nil { profiles[r.reaction.userId] = r.profile }

            context = EngageContext(myId: myId, engagements: engagements,
                                    replies: replies, profiles: profiles)
            feed = events.sorted { $0.ts > $1.ts }
            reactionCount = reactions.count
        } catch {
            loadError = error.localizedDescription
        }
    }

    private static func buildNotifications(progress: [ProgressItem],
                                           memberCount: Int,
                                           book: Book,
                                           myId: UUID?) -> [FeedEvent] {
        var items: [FeedEvent] = []
        for p in progress {
            let name = p.progress.userId == myId ? "You" : (p.profile?.displayName ?? "A reader")
            switch p.progress.status {
            case .finished:
                items.append(FeedEvent(
                    id: "progress-\(p.id)", ts: p.progress.finishedAt ?? p.progress.updatedAt,
                    kind: .notif(icon: "\u{1F389}", text: "\(name) finished the book", highlight: false),
                    targetType: .progress, targetId: p.id))
            case .reading where p.progress.currentPage > 0:
                let of = book.pageCount.map { " of \($0)" } ?? ""
                items.append(FeedEvent(
                    id: "progress-\(p.id)", ts: p.progress.updatedAt,
                    kind: .notif(icon: "\u{1F4D6}",
                                 text: "\(name) read to page \(p.progress.currentPage)\(of)",
                                 highlight: false),
                    targetType: .progress, targetId: p.id))
            case .reading, .notStarted:
                if p.progress.status == .reading || p.progress.startedAt != nil {
                    items.append(FeedEvent(
                        id: "progress-\(p.id)", ts: p.progress.startedAt ?? p.progress.updatedAt,
                        kind: .notif(icon: "\u{1F516}", text: "\(name) started reading", highlight: false),
                        targetType: .progress, targetId: p.id))
                }
            }
        }
        let finished = progress.filter { $0.progress.status == .finished }
        if memberCount > 0 && finished.count >= memberCount {
            let last = finished.map { $0.progress.finishedAt ?? $0.progress.updatedAt }.max() ?? Date()
            items.append(FeedEvent(
                id: "trophy-\(book.id)", ts: last,
                kind: .notif(icon: "\u{1F3C6}", text: "Everyone has finished the book!", highlight: true)))
        }
        return items
    }

    // Persist progress, update local state, refresh the feed (newly unlocked
    // reactions + updated activity). Port of applyProgress.
    func applyProgress(page: Int, status: ProgressStatus?) async throws {
        let st = status ?? (page > 0 ? .reading : .notStarted)
        let saved = try await API.setProgress(bookId: bookId, currentPage: page, status: st)
        mine = saved
        await loadFeed()
    }

    func startRealtime() async {
        let reload: @MainActor () -> Void = { [weak self] in
            guard let self else { return }
            self.bag.schedule { await self.loadFeed() }
        }
        let bid = bookId.uuidString.lowercased()
        bag.add(await API.subscribe(channelName: "reactions-\(bid)", table: "reactions",
                                    filter: "book_id=eq.\(bid)", onChange: reload))
        bag.add(await API.subscribe(channelName: "progress-\(bid)", table: "reading_progress",
                                    filter: "book_id=eq.\(bid)", onChange: reload))
        // Engagements + replies aren't book-scoped columns; subscribe broadly
        // and let the debounced reload re-pull this book's feed (like the web).
        bag.add(await API.subscribe(channelName: "book-engagements-\(bid)", table: "engagements",
                                    onChange: reload))
        bag.add(await API.subscribe(channelName: "book-replies-\(bid)", table: "reaction_replies",
                                    onChange: reload))
    }

    func stopRealtime() {
        bag.cancelAll()
    }
}

struct BookView: View {
    let clubId: UUID
    let bookId: UUID

    @Environment(SessionStore.self) private var session
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.dismiss) private var dismiss

    @State private var model: BookModel

    // composer
    @State private var reactionPage: Int = 0
    @State private var reactionBody = ""
    @State private var posting = false
    @State private var seededComposer = false

    // my progress panel
    @State private var progressPage: Int = 0

    // reaction -> progress sync prompt
    struct ProgressPrompt: Identifiable {
        let id = UUID()
        let reactionPage: Int
    }
    @State private var prompt: ProgressPrompt?
    @State private var promptHandled = false

    // review form
    @State private var reviewRating = 0
    @State private var reviewBody = ""
    @State private var seededReview = false

    // admin
    @State private var showDeadlineEditor = false
    @State private var confirmFinishBook = false

    // reset-progress + review-delete confirmations
    @State private var confirmResetProgress = false
    @State private var reviewToDelete: ReviewItem?

    init(clubId: UUID, bookId: UUID) {
        self.clubId = clubId
        self.bookId = bookId
        _model = State(initialValue: BookModel(clubId: clubId, bookId: bookId))
    }

    var body: some View {
        Group {
            if model.loading && model.book == nil {
                ProgressView().tint(Theme.yarnSage)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = model.loadError, model.book == nil {
                ScrollView {
                    LoadErrorView(message: err) { await model.load() }
                        .padding(16)
                }
            } else if let book = model.book {
                content(book)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(model.book?.title ?? "Book")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await model.load()
            seedFormState()
            await model.startRealtime()
        }
        .onDisappear { model.stopRealtime() }
        .refreshable {
            await model.load()
        }
        .sheet(item: $prompt, onDismiss: {
            // Dismissing still sets you to the reaction's page - you can never
            // sit below a reaction you posted (web parity).
            if !promptHandled, let page = lastPromptPage {
                savePrompt(page: page)
            }
            lastPromptPage = nil
        }) { p in
            progressPromptSheet(p)
        }
        .sheet(isPresented: $showDeadlineEditor) {
            if let book = model.book {
                DeadlineEditorSheet(book: book) {
                    await model.load()
                }
            }
        }
        .confirmationDialog(
            "Mark this book finished for the whole club? It moves to history.",
            isPresented: $confirmFinishBook, titleVisibility: .visible
        ) {
            Button("Mark finished", role: .destructive) { finishBookForClub() }
        }
        .confirmationDialog(
            "Reset your reading progress for this book? This re-locks reactions past your current page.",
            isPresented: $confirmResetProgress, titleVisibility: .visible
        ) {
            Button("Reset progress", role: .destructive) { resetProgress() }
        }
        .confirmationDialog(
            "Delete your review?",
            isPresented: Binding(get: { reviewToDelete != nil },
                                 set: { if !$0 { reviewToDelete = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let item = reviewToDelete { deleteReview(item.id) }
                reviewToDelete = nil
            }
        }
    }

    @State private var lastPromptPage: Int?

    private func seedFormState() {
        if !seededComposer {
            reactionPage = model.myPage
            progressPage = model.myPage
            seededComposer = true
        }
        if !seededReview, let rev = model.myReview {
            reviewRating = rev.rating ?? 0
            reviewBody = rev.body ?? ""
            seededReview = true
        }
    }

    // MARK: layout

    private func content(_ book: Book) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                bookHeader(book)
                progressPanel(book)
                composer(book)

                HStack(spacing: 6) {
                    Text("the feed")
                        .font(Theme.displaySemiBold(17))
                        .foregroundStyle(Theme.textPrimary)
                    if model.reactionCount > 0 {
                        Text("(\(model.reactionCount) reaction\(model.reactionCount == 1 ? "" : "s") unlocked)")
                            .font(Theme.monoFont(11))
                            .foregroundStyle(Theme.textMuted)
                    }
                }

                if model.feed.isEmpty {
                    Text("nothing here yet - be the first to post a reaction. log more pages to unlock reactions from others.")
                        .font(Theme.displayFont(14))
                        .foregroundStyle(Theme.textMuted)
                } else {
                    ForEach(model.feed) { entry in
                        feedCard(entry)
                    }
                }

                reviewsSection(book)
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func bookHeader(_ book: Book) -> some View {
        HStack(alignment: .top, spacing: 12) {
            BookCoverView(coverUrl: book.coverUrl, width: 76)
            VStack(alignment: .leading, spacing: 4) {
                Text(book.title)
                    .font(Theme.displayBold(20))
                    .foregroundStyle(Theme.textPrimary)
                if let author = book.author, !author.isEmpty {
                    Text(author)
                        .font(Theme.displayFont(15))
                        .foregroundStyle(Theme.textMuted)
                }
                if let pages = book.pageCount {
                    Text("\(pages) pages")
                        .font(Theme.monoFont(11))
                        .foregroundStyle(Theme.textMuted)
                }
                Text("status: \(book.status.rawValue)")
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
                if book.deadline != nil {
                    HStack(spacing: 6) {
                        Text("deadline: \(Format.date(book.deadline))")
                            .font(Theme.monoFont(11))
                            .foregroundStyle(Theme.textMuted)
                        DeadlineBadge(deadline: book.deadline)
                    }
                }
                if model.isCreator && book.status != .finished {
                    HStack(spacing: 8) {
                        Button("\u{270E} edit deadline") { showDeadlineEditor = true }
                            .buttonStyle(.ghostSmall)
                        Button("finish for club") { confirmFinishBook = true }
                            .buttonStyle(.ghostSmall)
                    }
                    .padding(.top, 4)
                }
            }
            Spacer(minLength: 0)
        }
        .patch(seed: book.id.uuidString)
    }

    // MARK: my progress (the web's right rail)

    private func progressPanel(_ book: Book) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("my progress")
                .font(Theme.displaySemiBold(16))
                .foregroundStyle(Theme.textPrimary)
            HStack(spacing: 8) {
                Text("page")
                    .font(Theme.monoFont(13))
                    .foregroundStyle(Theme.textMuted)
                TextField("0", value: $progressPage, format: .number)
                    .keyboardType(.numberPad)
                    .font(Theme.monoMedium(15))
                    .frame(width: 70)
                    .padding(6)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Theme.surface2))
                    .multilineTextAlignment(.center)
                if let pages = book.pageCount {
                    Text("/ \(pages)")
                        .font(Theme.monoFont(13))
                        .foregroundStyle(Theme.textMuted)
                }
                Spacer()
                Button("save") { saveProgress(nil) }
                    .buttonStyle(.primarySmall)
            }
            HStack(spacing: 8) {
                if !model.hasStarted {
                    Button("mark started") { saveProgress(.reading) }
                        .buttonStyle(.ghostSmall)
                }
                Button("mark finished \u{2713}") { markFinished(book) }
                    .buttonStyle(.ghostSmall)
                // Reset only shows when there's a progress row to clear (web parity).
                if model.mine != nil {
                    Button("reset progress") { confirmResetProgress = true }
                        .buttonStyle(.ghostSmall)
                        .tint(Theme.negative)
                }
            }
            Text("reactions unlock for you up to the page you've logged. log honestly to avoid spoilers.")
                .font(Theme.monoFont(11))
                .foregroundStyle(Theme.textMuted)
        }
        .patch(accent: Theme.yarnSlate, seed: "progress-panel")
    }

    // MARK: reaction composer

    private func composer(_ book: Book) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("post a reaction")
                .font(Theme.displaySemiBold(16))
                .foregroundStyle(Theme.textPrimary)
            HStack(spacing: 8) {
                Text("at page")
                    .font(Theme.monoFont(13))
                    .foregroundStyle(Theme.textMuted)
                TextField("0", value: $reactionPage, format: .number)
                    .keyboardType(.numberPad)
                    .font(Theme.monoMedium(15))
                    .frame(width: 70)
                    .padding(6)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Theme.surface2))
                    .multilineTextAlignment(.center)
            }
            TextField("what happened? how'd it hit you? (only visible to people who've read this far)",
                      text: $reactionBody, axis: .vertical)
                .font(Theme.displayFont(15))
                .lineLimit(2...5)
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 6).fill(Theme.surface2))
            Button(posting ? "posting\u{2026}" : "post reaction") { postReaction(book) }
                .buttonStyle(.primarySmall)
                .disabled(posting || reactionBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .patch(accent: Theme.yarnSage, seed: "composer")
    }

    // MARK: feed cards

    @ViewBuilder
    private func feedCard(_ entry: FeedEvent) -> some View {
        switch entry.kind {
        case .reaction(let item, _):
            ReactionCard(item: item,
                         context: model.context,
                         isMine: item.reaction.userId == session.userId,
                         onChange: { await model.loadFeed() })
                .patch(seed: entry.id)
        case .notif(let icon, let text, let highlight):
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 10) {
                    Text(icon).font(.system(size: 17))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(text)
                            .font(Theme.displayFont(15))
                            .foregroundStyle(Theme.textPrimary)
                        Text(Format.timeAgo(entry.ts))
                            .font(Theme.monoFont(11))
                            .foregroundStyle(Theme.textMuted)
                    }
                    Spacer(minLength: 0)
                }
                if let type = entry.targetType, let id = entry.targetId {
                    EngagementBar(targetType: type, targetId: id, context: model.context) {
                        await model.loadFeed()
                    }
                }
            }
            .patch(accent: highlight ? Theme.yarnOchre : Theme.yarnBark, seed: entry.id, padding: 12)
        }
    }

    // MARK: reviews

    @ViewBuilder
    private func reviewsSection(_ book: Book) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("reviews")
                .font(Theme.displaySemiBold(17))
                .foregroundStyle(Theme.textPrimary)

            if model.finished {
                VStack(alignment: .leading, spacing: 8) {
                    StarRatingView(rating: reviewRating, editable: $reviewRating)
                    TextField("your overall take on the book\u{2026}", text: $reviewBody, axis: .vertical)
                        .font(Theme.displayFont(15))
                        .lineLimit(3...6)
                        .padding(8)
                        .background(RoundedRectangle(cornerRadius: 6).fill(Theme.surface2))
                    Button(model.myReview == nil ? "post review" : "update review") {
                        saveReview(book)
                    }
                    .buttonStyle(.primarySmall)
                }

                if model.reviews.isEmpty {
                    Text("no reviews yet.")
                        .font(Theme.displayFont(14))
                        .foregroundStyle(Theme.textMuted)
                } else {
                    ForEach(model.reviews) { item in
                        reviewCard(item)
                    }
                }
            } else {
                Text("\u{1F512} reviews unlock once you've marked the book finished.")
                    .font(Theme.displayFont(14))
                    .foregroundStyle(Theme.textMuted)
            }
        }
        .patch(accent: Theme.yarnMauve, seed: "reviews")
    }

    private func reviewCard(_ item: ReviewItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                ReaderLink(userId: item.review.userId) {
                    HStack(spacing: 8) {
                        AvatarView(profile: item.profile, size: 28)
                        Text(item.profile?.displayName ?? "Reader")
                            .font(Theme.monoMedium(13))
                            .foregroundStyle(Theme.textPrimary)
                    }
                }
                Spacer()
                StarRatingView(rating: item.review.rating ?? 0)
                if item.review.userId == session.userId {
                    Button {
                        reviewToDelete = item
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Theme.textMuted)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Delete review")
                }
            }
            if let body = item.review.body, !body.isEmpty {
                Text(body)
                    .font(Theme.displayFont(15))
                    .foregroundStyle(Theme.textPrimary)
            }
        }
        .padding(.vertical, 6)
    }

    // MARK: progress prompt (reaction -> progress sync)

    private func progressPromptSheet(_ p: ProgressPrompt) -> some View {
        PromptBody(prompt: p,
                   loggedNow: model.myPage,
                   pageCount: model.book?.pageCount) { page in
            promptHandled = true
            savePrompt(page: max(p.reactionPage, page))
            prompt = nil
        } onNotNow: {
            promptHandled = true
            savePrompt(page: p.reactionPage)
            prompt = nil
        }
        .presentationDetents([.medium])
    }

    private struct PromptBody: View {
        let prompt: ProgressPrompt
        let loggedNow: Int
        let pageCount: Int?
        let onSave: (Int) -> Void
        let onNotNow: () -> Void

        @State private var page: Int = 0

        var body: some View {
            VStack(alignment: .leading, spacing: 16) {
                Text("My progress")
                    .font(Theme.displayBold(20))
                Text("You reacted at page \(prompt.reactionPage), but you're logged at page \(loggedNow). Update how far you've read?")
                    .font(Theme.displayFont(15))
                    .foregroundStyle(Theme.textMuted)
                HStack(spacing: 8) {
                    Text("page read to")
                        .font(Theme.monoFont(13))
                        .foregroundStyle(Theme.textMuted)
                    TextField("0", value: $page, format: .number)
                        .keyboardType(.numberPad)
                        .font(Theme.monoMedium(15))
                        .frame(width: 80)
                        .padding(6)
                        .background(RoundedRectangle(cornerRadius: 6).fill(Theme.surface2))
                        .multilineTextAlignment(.center)
                }
                HStack(spacing: 12) {
                    Button("not now") { onNotNow() }
                        .buttonStyle(.ghost)
                    Button("Save progress") { onSave(page) }
                        .buttonStyle(.primary)
                }
            }
            .padding(22)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Theme.bg.ignoresSafeArea())
            .onAppear { page = prompt.reactionPage }
        }
    }

    // MARK: actions

    private func saveProgress(_ status: ProgressStatus?) {
        Task {
            do {
                try await model.applyProgress(page: max(0, progressPage), status: status)
                progressPage = model.myPage
                toasts.show("Progress saved", .success)
            } catch {
                toasts.error(error)
            }
        }
    }

    private func markFinished(_ book: Book) {
        if let pages = book.pageCount { progressPage = pages }
        Task {
            do {
                try await model.applyProgress(page: max(0, progressPage), status: .finished)
                progressPage = model.myPage
                toasts.show("Progress saved", .success)
                await model.load() // reviews just unlocked
                seededReview = false
                seedFormState()
            } catch {
                toasts.error(error)
            }
        }
    }

    private func postReaction(_ book: Book) {
        let body = reactionBody.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !posting else { return }
        posting = true
        let page = max(0, reactionPage)
        Task {
            defer { posting = false }
            do {
                try await API.addReaction(bookId: book.id, page: page, body: body)
                reactionBody = ""
                toasts.show("Reaction posted", .success)
                await model.loadFeed()
                // Reacted past what you've logged? Offer to update My Progress
                // so the group doesn't see you flagged behind a page you've
                // clearly read (dismissal still bumps you to the reaction page).
                if page > model.myPage {
                    promptHandled = false
                    lastPromptPage = page
                    prompt = ProgressPrompt(reactionPage: page)
                }
            } catch {
                toasts.error(error)
            }
        }
    }

    private func savePrompt(page: Int) {
        Task {
            do {
                try await model.applyProgress(page: page, status: .reading)
                progressPage = model.myPage
            } catch {
                toasts.error(error)
            }
        }
    }

    // Reset my progress: delete my reading_progress row (RLS owner-only). This
    // re-locks any reactions I'd unlocked by reading past them - the spoiler gate
    // reads live from progress - so reload to reflect the relocked state.
    private func resetProgress() {
        Task {
            do {
                try await API.deleteProgress(bookId: bookId)
                model.mine = nil
                progressPage = 0
                seededReview = false
                await model.load()
                toasts.show("Progress reset", .success)
            } catch {
                toasts.error(error)
            }
        }
    }

    private func deleteReview(_ id: UUID) {
        Task {
            do {
                try await API.deleteReview(id)
                toasts.show("Review deleted", .success)
                model.reviews = (try? await API.bookReviews(bookId)) ?? model.reviews
                model.myReview = try? await API.myReview(bookId: bookId)
                if model.myReview == nil {
                    reviewRating = 0
                    reviewBody = ""
                }
            } catch {
                toasts.error(error)
            }
        }
    }

    private func saveReview(_ book: Book) {
        Task {
            do {
                let body = reviewBody.trimmingCharacters(in: .whitespacesAndNewlines)
                try await API.saveReview(bookId: book.id,
                                         rating: reviewRating == 0 ? nil : reviewRating,
                                         body: body.isEmpty ? nil : body)
                toasts.show("Review saved", .success)
                model.reviews = (try? await API.bookReviews(book.id)) ?? model.reviews
                model.myReview = try? await API.myReview(bookId: book.id)
            } catch {
                toasts.error(error)
            }
        }
    }

    private func finishBookForClub() {
        Task {
            do {
                try await API.finishBook(bookId)
                toasts.show("Book finished", .success)
                dismiss()
            } catch {
                toasts.error(error)
            }
        }
    }
}

// MARK: - reaction card (feed item with author edit/delete)

// One reaction in the feed. The author gets edit (pencil) + delete (x). Tapping
// edit swaps the body for an inline page + text editor; save patches both
// (author-only per RLS reactions_update_own), cancel restores. Port of the web's
// reactionCardHTML inline-edit form.
private struct ReactionCard: View {
    let item: ReactionItem
    let context: EngageContext
    let isMine: Bool
    let onChange: () async -> Void

    @Environment(ToastCenter.self) private var toasts
    @State private var editing = false
    @State private var editPage = 0
    @State private var editBody = ""
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ReaderLink(userId: item.reaction.userId) {
                    HStack(spacing: 8) {
                        AvatarView(profile: item.profile, size: 30)
                        Text(item.profile?.displayName ?? "Reader")
                            .font(Theme.monoMedium(13))
                            .foregroundStyle(Theme.textPrimary)
                    }
                }
                Text("p.\(item.reaction.page)")
                    .font(Theme.monoMedium(11))
                    .foregroundStyle(.white)
                    .padding(.vertical, 2)
                    .padding(.horizontal, 6)
                    .background(Capsule().fill(Theme.yarnSlate))
                Text(Format.timeAgo(item.reaction.createdAt))
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
                Spacer()
                if isMine {
                    Button {
                        editPage = item.reaction.page
                        editBody = item.reaction.body
                        editing = true
                    } label: {
                        Image(systemName: "pencil")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Theme.textMuted)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Edit reaction")
                    Button {
                        deleteReaction(item.id)
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Theme.textMuted)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Delete reaction")
                }
            }
            if editing {
                HStack(spacing: 8) {
                    Text("at page")
                        .font(Theme.monoFont(13))
                        .foregroundStyle(Theme.textMuted)
                    TextField("0", value: $editPage, format: .number)
                        .keyboardType(.numberPad)
                        .font(Theme.monoMedium(15))
                        .frame(width: 70)
                        .padding(6)
                        .background(RoundedRectangle(cornerRadius: 6).fill(Theme.surface2))
                        .multilineTextAlignment(.center)
                }
                TextField("what happened?", text: $editBody, axis: .vertical)
                    .font(Theme.displayFont(15))
                    .lineLimit(2...5)
                    .padding(8)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Theme.surface2))
                HStack(spacing: 8) {
                    Button("save") { saveEdit() }
                        .buttonStyle(.primarySmall)
                        .disabled(saving || editBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Button("cancel") { editing = false }
                        .buttonStyle(.ghostSmall)
                }
            } else {
                Text(item.reaction.body)
                    .font(Theme.displayFont(16))
                    .foregroundStyle(Theme.textPrimary)
            }
            EngagementBar(targetType: .reaction, targetId: item.id, context: context) {
                await onChange()
            }
            ReplyThreadView(reactionId: item.id, context: context) {
                await onChange()
            }
        }
    }

    private func saveEdit() {
        let body = editBody.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !saving else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                try await API.updateReaction(item.id, page: max(0, editPage), body: body)
                editing = false
                toasts.show("Reaction updated", .success)
                await onChange()
            } catch {
                toasts.error(error)
            }
        }
    }

    private func deleteReaction(_ id: UUID) {
        Task {
            do {
                try await API.deleteReaction(id)
                await onChange()
            } catch {
                toasts.error(error)
            }
        }
    }
}

// MARK: - deadline editor (port of the edit-deadline modal)

struct DeadlineEditorSheet: View {
    let book: Book
    let onSaved: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(ToastCenter.self) private var toasts

    @State private var hasDeadline: Bool
    @State private var date: Date
    @State private var saving = false

    init(book: Book, onSaved: @escaping () async -> Void) {
        self.book = book
        self.onSaved = onSaved
        _hasDeadline = State(initialValue: book.deadline != nil)
        _date = State(initialValue: book.deadline ?? Date().addingTimeInterval(14 * 86400))
    }

    var body: some View {
        NavigationStack {
            Form {
                Toggle("has a deadline", isOn: $hasDeadline)
                    .font(Theme.displayFont(16))
                if hasDeadline {
                    DatePicker("finish-by date", selection: $date, displayedComponents: .date)
                        .font(Theme.displayFont(16))
                }
                Section {
                    Text("turn the deadline off and save to remove it.")
                        .font(Theme.displayFont(14))
                        .foregroundStyle(Theme.textMuted)
                }
            }
            .navigationTitle("Edit deadline")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .font(Theme.monoMedium(15))
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .font(Theme.monoMedium(15))
                        .disabled(saving)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func save() {
        saving = true
        Task {
            defer { saving = false }
            do {
                // Anchor to local noon so the saved UTC date doesn't drift
                // across day boundaries (web parity).
                var deadline: Date?
                if hasDeadline {
                    var comps = Calendar.current.dateComponents([.year, .month, .day], from: date)
                    comps.hour = 12
                    deadline = Calendar.current.date(from: comps)
                }
                try await API.updateBook(book.id, changes: API.BookChanges(deadline: .some(deadline)))
                toasts.show(deadline == nil ? "Deadline removed" : "Deadline updated", .success)
                await onSaved()
                dismiss()
            } catch {
                toasts.error(error)
            }
        }
    }
}
