// Club detail (port of views/club.js): current book panel, join-code chip,
// roster with everyone's progress, and the owner/member menu (cover photo,
// change book, leave, delete). Web confirm() dialogs become native
// confirmationDialogs; the file input becomes PhotosPicker + the cropper.

import SwiftUI
import PhotosUI
import Observation

@MainActor
@Observable
final class ClubModel {
    let clubId: UUID

    var club: Club?
    var members: [Member] = []
    var book: Book?
    var progress: [ProgressItem] = []
    var loading = true
    var loadError: String?

    init(clubId: UUID) {
        self.clubId = clubId
    }

    func load() async {
        do {
            async let clubReq = API.getClub(clubId)
            async let membersReq = API.clubMembers(clubId)
            async let bookReq = API.currentBook(clubId)
            let (club, members, book) = try await (clubReq, membersReq, bookReq)
            self.club = club
            self.members = members
            self.book = book
            self.progress = book == nil ? [] : try await API.bookProgress(book!.id)
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
        loading = false
    }
}

struct ClubView: View {
    let clubId: UUID

    @Environment(SessionStore.self) private var session
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.dismiss) private var dismiss

    @State private var model: ClubModel
    @State private var showMenu = false
    @State private var showAddBook = false
    @State private var confirmLeave = false
    @State private var confirmDelete = false
    @State private var photoItem: PhotosPickerItem?
    @State private var pendingCrop: PendingCrop?

    init(clubId: UUID) {
        self.clubId = clubId
        _model = State(initialValue: ClubModel(clubId: clubId))
    }

    private var isOwner: Bool {
        guard let uid = session.userId else { return false }
        return model.members.first { $0.userId == uid }?.role.isOwnerTier ?? false
    }

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
            } else if let club = model.club {
                content(club)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(model.club?.name ?? "Club")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showMenu = true
                } label: {
                    Image(systemName: "gearshape")
                }
                .accessibilityLabel("Club settings")
            }
        }
        .sheet(isPresented: $showMenu) { menuSheet }
        .sheet(isPresented: $showAddBook) {
            if let club = model.club {
                AddBookSheet(club: club) { created in
                    Task { await model.load() }
                    _ = created
                }
            }
        }
        .fullScreenCover(item: $pendingCrop) { pending in
            ImageCropperView(image: pending.image, shape: .rounded) { data in
                if let data { uploadCover(data) }
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
        .task { await model.load() }
        .refreshable { await model.load() }
    }

    // MARK: content

    private func content(_ club: Club) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let desc = club.description, !desc.isEmpty {
                    Text(desc)
                        .font(Theme.displayFont(16))
                        .italic()
                        .foregroundStyle(Theme.textMuted)
                }

                // join code chip + picker/history shortcuts
                HStack(spacing: 8) {
                    Button {
                        UIPasteboard.general.string = club.joinCode
                        toasts.show("Code copied", .success)
                    } label: {
                        HStack(spacing: 5) {
                            Text("code:").font(Theme.monoFont(12)).foregroundStyle(Theme.textMuted)
                            Text(club.joinCode).font(Theme.monoMedium(13)).foregroundStyle(Theme.textPrimary)
                            Image(systemName: "doc.on.doc").font(.system(size: 10))
                                .foregroundStyle(Theme.textMuted)
                        }
                        .padding(.vertical, 6)
                        .padding(.horizontal, 10)
                        .background(Capsule().fill(Theme.surface2))
                    }
                    .buttonStyle(.plain)
                    Spacer()
                    NavigationLink(value: Route.picker(clubId: club.id)) {
                        Text("\u{1F3A1} Pick next")
                    }
                    .buttonStyle(.ghostSmall)
                    NavigationLink(value: Route.history(clubId: club.id)) {
                        Text("\u{1F4DC} History")
                    }
                    .buttonStyle(.ghostSmall)
                }

                bookPanel(club)
                membersPanel(club)
            }
            .padding(16)
        }
    }

    @ViewBuilder
    private func bookPanel(_ club: Club) -> some View {
        if let book = model.book {
            NavigationLink(value: Route.book(clubId: club.id, bookId: book.id)) {
                HStack(alignment: .top, spacing: 12) {
                    BookCoverView(coverUrl: book.coverUrl, width: 64)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("now reading")
                            .font(Theme.monoFont(11))
                            .foregroundStyle(Theme.accent(club.accent))
                        Text(book.title)
                            .font(Theme.displayBold(19))
                            .foregroundStyle(Theme.textPrimary)
                            .multilineTextAlignment(.leading)
                        if let author = book.author, !author.isEmpty {
                            Text(author)
                                .font(Theme.displayFont(15))
                                .foregroundStyle(Theme.textMuted)
                        }
                        Text(bookSub(book))
                            .font(Theme.monoFont(11))
                            .foregroundStyle(Theme.textMuted)
                        DeadlineBadge(deadline: book.deadline)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .foregroundStyle(Theme.textMuted)
                }
            }
            .buttonStyle(.plain)
            .patch(accent: Theme.accent(club.accent), seed: book.id.uuidString)
        } else {
            VStack(spacing: 10) {
                Text("no book in progress.")
                    .font(Theme.displayFont(16))
                    .foregroundStyle(Theme.textMuted)
                Button("+ Set the current book") { showAddBook = true }
                    .buttonStyle(.primary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .patch(accent: Theme.accent(club.accent), seed: "empty-book")
        }
    }

    private func bookSub(_ book: Book) -> String {
        var parts: [String] = []
        if let pages = book.pageCount { parts.append("\(pages) pages") }
        let picker = model.members.first { $0.userId == book.pickedBy }?.displayName ?? "\u{2014}"
        parts.append("picked by \(picker)")
        return parts.joined(separator: " \u{00B7} ")
    }

    private func membersPanel(_ club: Club) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("members & progress")
                    .font(Theme.displaySemiBold(16))
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                if let book = model.book {
                    NavigationLink(value: Route.book(clubId: club.id, bookId: book.id)) {
                        Text("update mine \u{2192}")
                    }
                    .buttonStyle(.ghostSmall)
                }
            }
            ForEach(model.members) { member in
                memberRow(member)
            }
        }
        .patch(seed: "members-\(club.id)")
    }

    private func memberRow(_ member: Member) -> some View {
        let p = model.progress.first { $0.progress.userId == member.userId }?.progress
        let pct = ProgressMath.percent(page: p?.currentPage, of: model.book?.pageCount)

        return HStack(spacing: 10) {
            AvatarView(profile: member.profile, size: 34)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(member.displayName)
                        .font(Theme.displaySemiBold(15))
                        .foregroundStyle(Theme.textPrimary)
                    if member.role.isOwnerTier {
                        Text(member.role.rawValue)
                            .font(Theme.monoFont(10))
                            .foregroundStyle(.white)
                            .padding(.vertical, 2)
                            .padding(.horizontal, 6)
                            .background(Capsule().fill(Theme.yarnBark))
                    }
                }
                if model.book != nil {
                    YarnProgressBar(percent: pct)
                    Text(ProgressMath.statusLabel(progress: p, pageCount: model.book?.pageCount))
                        .font(Theme.monoFont(11))
                        .foregroundStyle(Theme.textMuted)
                }
            }
            Spacer()
        }
    }

    // MARK: club menu (port of clubMenu modal)

    private var menuSheet: some View {
        NavigationStack {
            List {
                if let club = model.club {
                    if isOwner {
                        Section("club photo") {
                            HStack(spacing: 14) {
                                ClubAvatarView(club: club, size: 64)
                                PhotosPicker(selection: $photoItem, matching: .images) {
                                    Text("change club photo")
                                        .font(Theme.monoFont(14))
                                }
                            }
                        }
                    }
                    Section {
                        LabeledContent("join code", value: club.joinCode)
                            .font(Theme.monoFont(14))
                    }
                    Section {
                        if isOwner {
                            Button("Change current book") {
                                showMenu = false
                                showAddBook = true
                            }
                        }
                        Button("Leave club", role: .destructive) {
                            confirmLeave = true
                        }
                        if isOwner {
                            Button("Delete club", role: .destructive) {
                                confirmDelete = true
                            }
                        }
                    }
                }
            }
            .navigationTitle(model.club?.name ?? "Club")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { showMenu = false }
                }
            }
            .confirmationDialog("Leave \(model.club?.name ?? "this club")?",
                                isPresented: $confirmLeave, titleVisibility: .visible) {
                Button("Leave club", role: .destructive) { leave() }
            }
            .confirmationDialog(
                "Permanently delete \(model.club?.name ?? "this club")? This removes the club and ALL its books, reactions, reviews and progress for everyone. This cannot be undone.",
                isPresented: $confirmDelete, titleVisibility: .visible
            ) {
                Button("Delete club", role: .destructive) { delete() }
            }
        }
        .presentationDetents([.medium, .large])
    }

    // MARK: actions

    private func uploadCover(_ jpegData: Data) {
        guard let club = model.club else { return }
        Task {
            do {
                let url = try await API.uploadClubImage(clubId: club.id, jpegData: jpegData)
                try await API.updateClub(club.id, changes: API.ClubChanges(photoUrl: url))
                toasts.show("Club photo updated", .success)
                await model.load()
            } catch {
                toasts.error(error)
            }
        }
    }

    private func leave() {
        Task {
            do {
                try await API.leaveClub(clubId)
                toasts.show("Left club")
                showMenu = false
                dismiss()
            } catch {
                toasts.error(error)
            }
        }
    }

    private func delete() {
        Task {
            do {
                try await API.deleteClub(clubId)
                toasts.show("Club deleted")
                showMenu = false
                dismiss()
            } catch {
                toasts.error(error)
            }
        }
    }
}

// MARK: - add/change current book (port of addBookModal)

struct AddBookSheet: View {
    let club: Club
    var onDone: ((Book) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @Environment(ToastCenter.self) private var toasts

    @State private var query = ""
    @State private var results: [OpenLibraryBook] = []
    @State private var searching = false
    @State private var searchNote: String?
    @State private var searchTask: Task<Void, Never>?
    @State private var adding = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TextField("search a title or author", text: $query)
                    .font(Theme.displayFont(17))
                    .textFieldStyle(.plain)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Theme.surface2))
                    .padding(16)
                    .onChange(of: query) { _, term in
                        scheduleSearch(term)
                    }

                List {
                    if searching {
                        HStack {
                            ProgressView().tint(Theme.yarnSage)
                            Text("searching\u{2026}")
                                .font(Theme.displayFont(14))
                                .foregroundStyle(Theme.textMuted)
                        }
                    } else if let note = searchNote {
                        Text(note)
                            .font(Theme.displayFont(14))
                            .foregroundStyle(Theme.textMuted)
                    }
                    ForEach(results) { book in
                        Button {
                            add(book)
                        } label: {
                            HStack(spacing: 10) {
                                BookCoverView(coverUrl: book.coverUrl, width: 36)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(book.title)
                                        .font(Theme.displaySemiBold(15))
                                        .foregroundStyle(Theme.textPrimary)
                                    Text(subtitle(book))
                                        .font(Theme.monoFont(11))
                                        .foregroundStyle(Theme.textMuted)
                                }
                            }
                        }
                        .disabled(adding)
                    }
                }
                .listStyle(.plain)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Set the current book")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func subtitle(_ book: OpenLibraryBook) -> String {
        var parts: [String] = []
        if let author = book.author { parts.append(author) }
        if let year = book.year { parts.append("\(year)") }
        if let pages = book.pageCount { parts.append("\(pages)p") }
        return parts.joined(separator: " \u{00B7} ")
    }

    // Debounced lookup (350ms like the web) with a stale-response guard: a slow
    // response for an earlier term must never clobber newer results.
    private func scheduleSearch(_ term: String) {
        searchTask?.cancel()
        let trimmed = term.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else {
            results = []
            searching = false
            searchNote = nil
            return
        }
        searching = true
        searchNote = nil
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            do {
                let found = try await OpenLibraryAPI.searchBooks(query: trimmed)
                guard !Task.isCancelled,
                      query.trimmingCharacters(in: .whitespaces) == trimmed else { return }
                results = found
                searchNote = found.isEmpty ? "no matches." : nil
            } catch {
                guard !Task.isCancelled,
                      query.trimmingCharacters(in: .whitespaces) == trimmed else { return }
                results = []
                searchNote = "lookup failed: \(error.localizedDescription)"
            }
            searching = false
        }
    }

    private func add(_ chosen: OpenLibraryBook) {
        guard !adding else { return }
        adding = true
        Task {
            defer { adding = false }
            do {
                // Club-level default deadline, like the web modal.
                var deadline: Date?
                if club.deadlinesEnabled, let days = club.defaultDeadlineDays {
                    deadline = Date().addingTimeInterval(Double(days) * 86400)
                }
                let created = try await API.addBook(clubId: club.id, book: API.NewBook(
                    title: chosen.title,
                    author: chosen.author,
                    coverUrl: chosen.coverUrl,
                    openLibraryId: chosen.openLibraryId,
                    pageCount: chosen.pageCount,
                    deadline: deadline
                ))
                toasts.show("Book set", .success)
                onDone?(created)
                dismiss()
            } catch {
                toasts.error(error)
            }
        }
    }
}
