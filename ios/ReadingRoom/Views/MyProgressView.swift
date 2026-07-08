// "My Progress" tab (port of views/progress.js): the logging hub. Every current
// book across my clubs, each with my position AND inline entry forms (update
// progress / post a reaction) so logging never requires a trip through the
// club -> book screens. The book header still navigates to the full book page.
// The reaction->progress gate mirrors book.js/BookView: reacting past your
// logged page prompts you to bump your progress, and dismissing still bumps you
// to the reaction's page.

import SwiftUI
import Observation

struct MyProgressView: View {
    struct Row: Identifiable {
        let club: Club
        let book: Book
        let mine: ReadingProgress?
        var id: UUID { book.id }
    }

    @State private var rows: [Row] = []
    @State private var loading = true
    @State private var loadError: String?
    @State private var bag = RealtimeBag()

    var body: some View {
        Group {
            if loading && rows.isEmpty && loadError == nil {
                VStack(spacing: 10) {
                    ProgressView().tint(Theme.yarnSage)
                    Text("loading your books\u{2026}")
                        .font(Theme.displayFont(15))
                        .foregroundStyle(Theme.textMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = loadError, rows.isEmpty {
                ScrollView {
                    LoadErrorView(message: err) { await load() }
                        .padding(16)
                }
            } else if rows.isEmpty {
                ScrollView {
                    EmptyStateView(
                        title: "you're not reading anything yet.",
                        hint: "join a club and set a book - your reading progress shows up here."
                    )
                    .padding(16)
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(rows) { row in
                            ProgressBookCard(row: row) { await load() }
                                .patch(accent: Theme.accent(row.club.accent),
                                       seed: row.book.id.uuidString, padding: 12)
                        }
                    }
                    .padding(16)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle("My Progress")
        .task {
            await load()
            let reload: @MainActor () -> Void = {
                bag.schedule { await load() }
            }
            bag.add(await API.subscribe(channelName: "progress-tab",
                                        table: "reading_progress",
                                        onChange: reload))
        }
        .onDisappear { bag.cancelAll() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            let clubs = try await API.myClubs()
            var built: [(Int, Row)] = []
            try await withThrowingTaskGroup(of: (Int, Row?).self) { group in
                for (i, summary) in clubs.enumerated() {
                    group.addTask {
                        guard let book = try await API.currentBook(summary.id) else {
                            return (i, nil)
                        }
                        let mine = try await API.myProgress(bookId: book.id)
                        return (i, Row(club: summary.club, book: book, mine: mine))
                    }
                }
                for try await (i, row) in group {
                    if let row { built.append((i, row)) }
                }
            }
            rows = built.sorted { $0.0 < $1.0 }.map(\.1)
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
        loading = false
    }
}

// One book: a tappable header (-> book page) plus inline progress + reaction
// entry, so posting happens right on the tab.
private struct ProgressBookCard: View {
    let row: MyProgressView.Row
    let onChange: () async -> Void

    @Environment(ToastCenter.self) private var toasts

    @State private var page: Int = 0
    @State private var seeded = false
    @State private var saving = false

    // reaction composer (collapsed by default)
    @State private var showReact = false
    @State private var reactPage: Int = 0
    @State private var reactBody = ""
    @State private var posting = false

    // reaction -> progress sync prompt
    struct ProgressPrompt: Identifiable {
        let id = UUID()
        let reactionPage: Int
    }
    @State private var prompt: ProgressPrompt?
    @State private var promptHandled = false

    // "Did you complete this book?" confirmation (page reached the last page).
    @State private var confirmComplete = false
    @State private var pendingPage: Int = 0

    private var myPage: Int { row.mine?.currentPage ?? 0 }
    private var finished: Bool { row.mine?.status == .finished }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            Divider().overlay(Theme.yarnClay.opacity(0.5))
            if finished {
                finishedForm
            } else {
                updateForm
                if showReact {
                    reactForm
                }
            }
        }
        .confirmationDialog("Did you complete this book?",
                            isPresented: $confirmComplete, titleVisibility: .visible) {
            Button("Yes, finished \u{2713}") {
                let target = row.book.pageCount ?? pendingPage
                page = target
                save(page: target, status: .finished)
            }
            Button("Not yet") { save(page: pendingPage, status: nil) }
            Button("Cancel", role: .cancel) { }
        } message: {
            if let pages = row.book.pageCount {
                Text("You're at page \(pendingPage) of \(pages). Mark \(row.book.title) as finished?")
            }
        }
        .onAppear {
            guard !seeded else { return }
            page = myPage
            reactPage = myPage
            seeded = true
        }
        .sheet(item: $prompt, onDismiss: {
            // Dismissing still sets you to the reaction's page - you can never
            // sit below a reaction you posted (web parity).
            if !promptHandled, let p = lastPromptPage {
                save(page: p, status: .reading, silent: true)
            }
            lastPromptPage = nil
        }) { p in
            promptSheet(p)
        }
    }

    @State private var lastPromptPage: Int?

    private var header: some View {
        NavigationLink(value: Route.book(clubId: row.club.id, bookId: row.book.id)) {
            HStack(alignment: .top, spacing: 12) {
                BookCoverView(coverUrl: row.book.coverUrl, width: 56)
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.book.title)
                        .font(Theme.displaySemiBold(16))
                        .foregroundStyle(Theme.textPrimary)
                        .multilineTextAlignment(.leading)
                    if let author = row.book.author, !author.isEmpty {
                        Text(author)
                            .font(Theme.displayFont(13))
                            .foregroundStyle(Theme.textMuted)
                    }
                    Text(row.club.name)
                        .font(Theme.monoFont(11))
                        .foregroundStyle(Theme.textMuted)
                    YarnProgressBar(percent: pct, tint: Theme.accent(row.club.accent))
                    HStack {
                        Text(statusLabel)
                            .font(Theme.monoFont(11))
                            .foregroundStyle(Theme.textMuted)
                        DeadlineBadge(deadline: row.book.deadline)
                        Spacer()
                        Text("\(pct)%")
                            .font(Theme.monoMedium(13))
                            .foregroundStyle(Theme.textPrimary)
                    }
                }
            }
        }
        .buttonStyle(.plain)
    }

    private var updateForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("page")
                    .font(Theme.monoFont(13))
                    .foregroundStyle(Theme.textMuted)
                TextField("0", value: $page, format: .number)
                    .keyboardType(.numberPad)
                    .font(Theme.monoMedium(15))
                    .frame(width: 70)
                    .padding(6)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Theme.surface2))
                    .multilineTextAlignment(.center)
                if let pages = row.book.pageCount {
                    Text("/ \(pages)")
                        .font(Theme.monoFont(13))
                        .foregroundStyle(Theme.textMuted)
                }
                Spacer()
                Button(saving ? "saving\u{2026}" : "Update progress") {
                    updateProgress()
                }
                .buttonStyle(.primarySmall)
                .disabled(saving)
            }
            HStack(spacing: 8) {
                Button("finished \u{2713}") {
                    let target = row.book.pageCount ?? max(0, page)
                    page = target
                    save(page: target, status: .finished)
                }
                .buttonStyle(.ghostSmall)
                Button(showReact ? "\u{1F4AC} close" : "\u{1F4AC} react") {
                    withAnimation { showReact.toggle() }
                }
                .buttonStyle(.ghostSmall)
            }
        }
    }

    // Finished books stay listed but lock editing: no page field / Update
    // button. A clear "Finished" badge, a reversible "still reading" control,
    // and a tap-through to the book page (header) to add reactions.
    private var finishedForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Text("\u{2713} Finished")
                    .font(Theme.monoMedium(13))
                    .foregroundStyle(Theme.positive)
                    .padding(.horizontal, 12).padding(.vertical, 4)
                    .background(Capsule().fill(Theme.yarnMoss.opacity(0.22)))
                    .overlay(Capsule().stroke(Theme.yarnMoss, lineWidth: 2))
                Spacer()
                Button("Mark as still reading") {
                    save(page: myPage, status: .reading)
                }
                .buttonStyle(.ghostSmall)
            }
            NavigationLink(value: Route.book(clubId: row.club.id, bookId: row.book.id)) {
                Text("\u{1F4AC} add a reaction")
                    .font(Theme.monoFont(13))
                    .foregroundStyle(Theme.yarnSlate)
            }
            .buttonStyle(.plain)
        }
    }

    // Update button: reaching (or passing) the last page asks whether the book
    // is complete; otherwise just save the reading progress.
    private func updateProgress() {
        let p = max(0, page)
        if let pages = row.book.pageCount, p >= pages, row.mine?.status != .finished {
            pendingPage = p
            confirmComplete = true
        } else {
            save(page: p, status: nil)
        }
    }

    private var reactForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("at page")
                    .font(Theme.monoFont(13))
                    .foregroundStyle(Theme.textMuted)
                TextField("0", value: $reactPage, format: .number)
                    .keyboardType(.numberPad)
                    .font(Theme.monoMedium(15))
                    .frame(width: 70)
                    .padding(6)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Theme.surface2))
                    .multilineTextAlignment(.center)
            }
            TextField("what happened? how'd it hit you? (only visible to people who've read this far)",
                      text: $reactBody, axis: .vertical)
                .font(Theme.displayFont(15))
                .lineLimit(2...5)
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 6).fill(Theme.surface2))
            Button(posting ? "posting\u{2026}" : "post reaction") { postReaction() }
                .buttonStyle(.primarySmall)
                .disabled(posting || reactBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    private var pct: Int {
        ProgressMath.percent(page: row.mine?.currentPage, of: row.book.pageCount)
    }

    private var statusLabel: String {
        guard let mine = row.mine else { return "not started" }
        if mine.status == .finished { return "finished \u{2713}" }
        if let pages = row.book.pageCount { return "page \(mine.currentPage) / \(pages)" }
        return "page \(mine.currentPage)"
    }

    // MARK: actions

    private func save(page: Int, status: ProgressStatus?, silent: Bool = false) {
        guard !saving else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                let st = status ?? (page > 0 ? .reading : .notStarted)
                _ = try await API.setProgress(bookId: row.book.id, currentPage: page, status: st)
                if !silent { toasts.show("Progress saved", .success) }
                await onChange()
            } catch {
                toasts.error(error)
            }
        }
    }

    private func postReaction() {
        let body = reactBody.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !posting else { return }
        posting = true
        let atPage = max(0, reactPage)
        Task {
            defer { posting = false }
            do {
                try await API.addReaction(bookId: row.book.id, page: atPage, body: body)
                reactBody = ""
                toasts.show("Reaction posted", .success)
                // Same gate as the book page: reacting past your logged page
                // offers to bump your progress.
                if atPage > myPage {
                    promptHandled = false
                    lastPromptPage = atPage
                    prompt = ProgressPrompt(reactionPage: atPage)
                } else {
                    await onChange()
                }
            } catch {
                toasts.error(error)
            }
        }
    }

    private func promptSheet(_ p: ProgressPrompt) -> some View {
        PromptBody(reactionPage: p.reactionPage,
                   loggedNow: myPage) { chosen in
            promptHandled = true
            page = max(p.reactionPage, chosen)
            save(page: max(p.reactionPage, chosen), status: .reading, silent: true)
            prompt = nil
        } onNotNow: {
            promptHandled = true
            page = p.reactionPage
            save(page: p.reactionPage, status: .reading, silent: true)
            prompt = nil
        }
        .presentationDetents([.medium])
    }

    private struct PromptBody: View {
        let reactionPage: Int
        let loggedNow: Int
        let onSave: (Int) -> Void
        let onNotNow: () -> Void

        @State private var page: Int = 0

        var body: some View {
            VStack(alignment: .leading, spacing: 16) {
                Text("My progress")
                    .font(Theme.displayBold(20))
                Text("You reacted at page \(reactionPage), but you're logged at page \(loggedNow). Update how far you've read?")
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
            .onAppear { page = reactionPage }
        }
    }
}
