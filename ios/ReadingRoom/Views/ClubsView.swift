// "My Clubs" (port of views/clubs.js): the club grid plus the create-club and
// join-with-code flows. The web modals become sheets.

import SwiftUI
import Observation

struct ClubsView: View {
    @Environment(ToastCenter.self) private var toasts
    @State private var clubs: [ClubSummary] = []
    @State private var loading = true
    @State private var loadError: String?
    @State private var showCreate = false
    @State private var showJoin = false

    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        Group {
            if loading && clubs.isEmpty {
                ProgressView().tint(Theme.yarnSage)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = loadError, clubs.isEmpty {
                ScrollView {
                    LoadErrorView(message: err) { await load() }
                        .padding(16)
                }
            } else if clubs.isEmpty {
                ScrollView {
                    EmptyStateView(
                        title: "you're not in any clubs yet.",
                        hint: "create one, or join with a 6-character code."
                    )
                    .padding(16)
                }
            } else {
                ScrollView {
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(clubs) { summary in
                            clubCard(summary)
                        }
                    }
                    .padding(16)
                }
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle("My Clubs")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    showJoin = true
                } label: {
                    Image(systemName: "number")
                }
                .accessibilityLabel("Join with code")
                Button {
                    showCreate = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("New club")
            }
        }
        .sheet(isPresented: $showCreate) { CreateClubSheet() }
        .sheet(isPresented: $showJoin) { JoinClubSheet() }
        .task { await load() }
        .refreshable { await load() }
    }

    private func clubCard(_ summary: ClubSummary) -> some View {
        NavigationLink(value: Route.club(summary.id)) {
            VStack(alignment: .leading, spacing: 6) {
                ClubAvatarView(club: summary.club, size: 44)
                Text(summary.club.name)
                    .font(Theme.displaySemiBold(17))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                if let desc = summary.club.description, !desc.isEmpty {
                    Text(desc)
                        .font(Theme.displayFont(13))
                        .foregroundStyle(Theme.textMuted)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                Text(meta(summary))
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
            }
            .frame(maxWidth: .infinity, minHeight: 130, alignment: .topLeading)
        }
        .buttonStyle(.plain)
        .patch(accent: Theme.accent(summary.club.accent), seed: summary.id.uuidString, padding: 12)
    }

    private func meta(_ summary: ClubSummary) -> String {
        var out = Format.count(summary.memberCount, "member")
        if summary.myRole.isOwnerTier {
            out += " \u{00B7} \(summary.myRole.rawValue)"
        }
        return out
    }

    private func load() async {
        do {
            clubs = try await API.myClubs()
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
        loading = false
    }
}

// MARK: - create club (port of createClubModal)

struct CreateClubSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(ToastCenter.self) private var toasts

    @State private var name = ""
    @State private var descriptionText = ""
    @State private var accent = Theme.accentChoices[0].name
    @State private var useDeadlines = false
    @State private var deadlineDays = 30
    @State private var submitting = false
    @State private var goTo: Route?

    var body: some View {
        NavigationStack {
            Form {
                Section("club name") {
                    TextField("e.g. The Tuesday Pages", text: $name)
                        .font(Theme.displayFont(16))
                }
                Section("description (optional)") {
                    TextField("what's this club about?", text: $descriptionText, axis: .vertical)
                        .font(Theme.displayFont(16))
                        .lineLimit(2...4)
                }
                Section("color") {
                    HStack(spacing: 12) {
                        ForEach(Theme.accentChoices, id: \.name) { choice in
                            Circle()
                                .fill(choice.color)
                                .frame(width: 30, height: 30)
                                .overlay(
                                    Circle().stroke(Theme.textPrimary,
                                                    lineWidth: accent == choice.name ? 2.5 : 0)
                                )
                                .onTapGesture { accent = choice.name }
                                .accessibilityLabel(choice.name)
                                .accessibilityAddTraits(accent == choice.name ? .isSelected : [])
                        }
                    }
                }
                Section {
                    Toggle("use reading deadlines by default", isOn: $useDeadlines)
                    if useDeadlines {
                        Stepper("days to finish a book: \(deadlineDays)",
                                value: $deadlineDays, in: 1...365)
                    }
                }
            }
            .navigationTitle("New Club")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { create() }
                        .disabled(submitting || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func create() {
        guard !submitting else { return }
        submitting = true
        Task {
            defer { submitting = false }
            do {
                let trimmedDesc = descriptionText.trimmingCharacters(in: .whitespacesAndNewlines)
                _ = try await API.createClub(API.NewClub(
                    name: name.trimmingCharacters(in: .whitespaces),
                    description: trimmedDesc.isEmpty ? nil : trimmedDesc,
                    accent: accent,
                    deadlinesEnabled: useDeadlines,
                    defaultDeadlineDays: useDeadlines ? deadlineDays : nil
                ))
                toasts.show("Club created", .success)
                dismiss()
            } catch {
                toasts.error(error)
            }
        }
    }
}

// MARK: - join club (port of joinClubModal)

struct JoinClubSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(ToastCenter.self) private var toasts

    @State private var code = ""
    @State private var submitting = false

    var body: some View {
        NavigationStack {
            Form {
                Section("join code") {
                    TextField("ABC123", text: $code)
                        .font(Theme.monoMedium(20))
                        .kerning(3)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .onChange(of: code) { _, newValue in
                            code = String(newValue.uppercased().prefix(6))
                        }
                }
                Section {
                    Text("codes are 6 characters - ask the club's creator for theirs.")
                        .font(Theme.displayFont(14))
                        .foregroundStyle(Theme.textMuted)
                }
            }
            .navigationTitle("Join a Club")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Find & Join") { join() }
                        .disabled(submitting || code.count < 6)
                }
            }
        }
    }

    private func join() {
        guard !submitting else { return }
        submitting = true
        Task {
            defer { submitting = false }
            do {
                guard let club = try await API.findClubByCode(code) else {
                    toasts.show("No club with that code", .error)
                    return
                }
                do {
                    try await API.joinClub(club.id)
                    toasts.show("Joined \(club.name)", .success)
                } catch {
                    // Already a member? The unique-key violation means we're in.
                    if error.localizedDescription.lowercased().contains("duplicate") {
                        toasts.show("You're already in \(club.name)")
                    } else {
                        throw error
                    }
                }
                dismiss()
            } catch {
                toasts.error(error)
            }
        }
    }
}
