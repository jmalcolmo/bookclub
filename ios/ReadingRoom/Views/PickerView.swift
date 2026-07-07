// "Who picks next?" (port of views/picker.js): choose a method, then run the
// spin wheel, the live vote, or a direct pick. The wheel is pure SwiftUI - the
// same shared WheelMath decides the winner FROM the final geometry, so the
// marker can never disagree with the announced name. The marble race stays
// parked, like the web.

import SwiftUI
import Observation

struct PickerView: View {
    let clubId: UUID

    @Environment(SessionStore.self) private var session
    @Environment(ToastCenter.self) private var toasts

    enum Stage {
        case none
        case wheel
        case pick
        case voteIntro
        case vote(Selection)
        case race
    }

    @State private var club: Club?
    @State private var members: [Member] = []
    @State private var openVote: Selection?
    @State private var loading = true
    @State private var loadError: String?
    @State private var stage: Stage = .none
    @State private var result: Member?   // decided winner banner
    @State private var decidedSelectionId: UUID?   // for opt-in announce
    @State private var announced = false
    @State private var announcing = false

    var body: some View {
        Group {
            if loading && club == nil {
                ProgressView().tint(Theme.yarnSage)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = loadError, club == nil {
                ScrollView {
                    LoadErrorView(message: err) { await load() }
                        .padding(16)
                }
            } else {
                content
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle("Who Picks Next?")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let winner = result {
                    resultBanner(winner)
                } else {
                    if let openVote, !isVoteStage {
                        VStack(spacing: 8) {
                            Text("\u{1F5F3}\u{FE0F} A vote is already in progress.")
                                .font(Theme.displayFont(16))
                                .foregroundStyle(Theme.textPrimary)
                            Button("Go to the open vote \u{2192}") {
                                stage = .vote(openVote)
                            }
                            .buttonStyle(.primary)
                        }
                        .frame(maxWidth: .infinity)
                        .patch(accent: Theme.warning, seed: openVote.id.uuidString)
                    }

                    Text("choose how your club decides who picks the next book.")
                        .font(Theme.displayFont(15))
                        .foregroundStyle(Theme.textMuted)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)

                    methodGrid
                    stageView
                }
            }
            .padding(16)
        }
    }

    // MARK: method grid

    private var methodGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
                  spacing: 12) {
            methodCard("\u{1F3A1}", "Spin the Wheel", "random spin lands on one member",
                       active: isStage(.wheel)) { stage = .wheel }
            methodCard("\u{1F5F3}\u{FE0F}", "Hold a Vote", "everyone votes; most votes wins",
                       active: isVoteStage || isStage(.voteIntro)) {
                if let openVote { stage = .vote(openVote) } else { stage = .voteIntro }
            }
            methodCard("\u{1F449}", "Just Pick", "choose a member directly",
                       active: isStage(.pick)) { stage = .pick }
            methodCard("\u{1F52E}", "Marble Race", "the classic - being rebuilt",
                       active: isStage(.race)) { stage = .race }
        }
    }

    private func methodCard(_ emoji: String, _ name: String, _ desc: String,
                            active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Text(emoji).font(.system(size: 30))
                Text(name)
                    .font(Theme.displaySemiBold(16))
                    .foregroundStyle(Theme.textPrimary)
                Text(desc)
                    .font(Theme.monoFont(11))
                    .foregroundStyle(Theme.textMuted)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, minHeight: 110)
        }
        .buttonStyle(.plain)
        .patch(accent: active ? Theme.yarnSage : Theme.yarnBark, seed: name, padding: 10)
    }

    private func isStage(_ s: Stage) -> Bool {
        switch (stage, s) {
        case (.wheel, .wheel), (.pick, .pick), (.voteIntro, .voteIntro),
             (.race, .race), (.none, .none):
            return true
        default:
            return false
        }
    }

    private var isVoteStage: Bool {
        if case .vote = stage { return true }
        return false
    }

    // MARK: stages

    @ViewBuilder
    private var stageView: some View {
        switch stage {
        case .none:
            EmptyView()
        case .wheel:
            WheelStage(members: members) { winner in
                decide(method: .wheel, winner: winner)
            }
        case .pick:
            pickStage
        case .voteIntro:
            voteIntroStage
        case .vote(let selection):
            VoteStage(clubId: clubId, selection: selection, members: members) { winner in
                decidedSelectionId = selection.id
                result = winner
                openVote = nil
            }
        case .race:
            raceStage
        }
    }

    private var pickStage: some View {
        VStack(spacing: 12) {
            Text("tap whoever should pick next.")
                .font(Theme.displayFont(14))
                .foregroundStyle(Theme.textMuted)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(members) { member in
                    Button {
                        decide(method: .pick, winner: member)
                    } label: {
                        HStack(spacing: 8) {
                            AvatarView(profile: member.profile, size: 40)
                            Text(member.displayName)
                                .font(Theme.displaySemiBold(15))
                                .foregroundStyle(Theme.textPrimary)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .padding(8)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Theme.surface))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.yarnBark, lineWidth: 1.5))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var voteIntroStage: some View {
        VStack(spacing: 12) {
            Text("open a vote - everyone in the club can cast one vote.")
                .font(Theme.displayFont(14))
                .foregroundStyle(Theme.textMuted)
            Button("Open the vote") { openTheVote() }
                .buttonStyle(.primary)
        }
        .frame(maxWidth: .infinity)
    }

    private var raceStage: some View {
        VStack(spacing: 8) {
            Text("\u{1F52E} The marble race is being rebuilt and isn't wired into clubs yet.")
                .font(Theme.displayFont(15))
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.center)
            Text("The classic standalone version lives on the web app.")
                .font(Theme.monoFont(12))
                .foregroundStyle(Theme.textMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .patch(seed: "race-parked")
    }

    private func resultBanner(_ winner: Member) -> some View {
        VStack(spacing: 10) {
            AvatarView(profile: winner.profile, size: 72)
            Text(winner.displayName)
                .font(Theme.displayBold(24))
                .foregroundStyle(Theme.textPrimary)
            Text("picks the next book!")
                .font(Theme.displayFont(16))
                .foregroundStyle(Theme.textMuted)
            // Opt-in: the "X will pick the next book" feed event is only created
            // when the decider taps this. Reaching this banner means the current
            // user just decided the selection, so they're the decider RLS allows.
            if let selId = decidedSelectionId {
                if announced {
                    Text("\u{1F4E3} Announced")
                        .font(Theme.monoFont(13))
                        .foregroundStyle(Theme.textMuted)
                } else {
                    Button(announcing ? "announcing\u{2026}" : "\u{1F4E3} Announce to the club") {
                        announce(selId)
                    }
                    .buttonStyle(.ghost)
                    .disabled(announcing)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .patch(accent: Theme.yarnOchre, seed: "result")
    }

    private func announce(_ selectionId: UUID) {
        guard !announcing else { return }
        announcing = true
        Task {
            defer { announcing = false }
            do {
                try await API.announceSelection(selectionId)
                announced = true
                toasts.show("Announced to the club", .success)
            } catch {
                toasts.error(error)
            }
        }
    }

    // MARK: data + actions

    private func load() async {
        do {
            async let clubReq = API.getClub(clubId)
            async let membersReq = API.clubMembers(clubId)
            async let openReq = API.openSelections(clubId)
            let (club, members, open) = try await (clubReq, membersReq, openReq)
            self.club = club
            self.members = members
            self.openVote = open.first { $0.method == .vote }
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
        loading = false
    }

    private func decide(method: SelectionMethod, winner: Member) {
        Task {
            do {
                let sel = try await API.createSelection(clubId: clubId, method: method)
                try await API.decideSelection(sel.id, resultUserId: winner.userId)
                // Retained so the decider can opt in to announcing this pick.
                decidedSelectionId = sel.id
            } catch {
                toasts.error(error)
            }
            // Show the banner even if recording failed, like the web (the
            // error toast already surfaced the problem).
            result = winner
        }
    }

    private func openTheVote() {
        Task {
            do {
                let sel = try await API.openVote(clubId: clubId)
                openVote = sel
                stage = .vote(sel)
            } catch {
                toasts.error(error)
            }
        }
    }
}

// MARK: - the wheel

// SVG wheel port: slices laid out clockwise from the top, labels on the mid
// radius, whole wheel spun with an eased rotation. Winner read back from the
// final rotation via WheelMath (shared with the tests).
private struct WheelStage: View {
    let members: [Member]
    let onDecided: (Member) -> Void

    @State private var rotation: Double = 0
    @State private var spinning = false
    @State private var winner: Member?

    private static let spinSeconds: Double = 4.8

    var body: some View {
        VStack(spacing: 16) {
            ZStack(alignment: .top) {
                wheel
                    .rotationEffect(.degrees(rotation))
                Text("\u{25BC}")
                    .font(.system(size: 26))
                    .foregroundStyle(Theme.yarnRust)
                    .offset(y: -10)
            }
            .frame(width: 300, height: 300)
            .frame(maxWidth: .infinity)

            if let winner {
                VStack(spacing: 10) {
                    AvatarView(profile: winner.profile, size: 72)
                    Text(winner.displayName)
                        .font(Theme.displayBold(24))
                        .foregroundStyle(Theme.textPrimary)
                    Text("picks the next book!")
                        .font(Theme.displayFont(16))
                        .foregroundStyle(Theme.textMuted)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .patch(accent: Theme.yarnOchre, seed: "wheel-result")
            } else {
                Button(spinning ? "spinning\u{2026}" : "Spin") { spin() }
                    .buttonStyle(.primary)
                    .disabled(spinning || members.isEmpty)
            }
        }
    }

    private var wheel: some View {
        ZStack {
            ForEach(Array(members.enumerated()), id: \.element.id) { index, member in
                let seg = 360.0 / Double(members.count)
                let start = Double(index) * seg
                let mid = start + seg / 2

                WheelSlice(startDegrees: start, endDegrees: start + seg)
                    .fill(Theme.colorFor(member.displayName))

                Text(shortName(member))
                    .font(Theme.monoMedium(12))
                    .foregroundStyle(.white)
                    .rotationEffect(.degrees(labelRotation(mid)))
                    .offset(labelOffset(mid))
            }
            Circle()
                .stroke(Theme.yarnBark, lineWidth: 5)
            Circle()
                .fill(Theme.surface2)
                .frame(width: 38, height: 38)
                .overlay(Circle().stroke(Theme.yarnBark, lineWidth: 3))
        }
    }

    // First name, truncated like the web wheelName().
    private func shortName(_ member: Member) -> String {
        let first = member.displayName
            .trimmingCharacters(in: .whitespaces)
            .split(separator: " ")
            .first.map(String.init) ?? "Reader"
        return first.count > 11 ? String(first.prefix(10)) + "\u{2026}" : first
    }

    // Labels read outward; bottom-half labels are flipped 180 in place so they
    // stay upright (port of the SVG label math).
    private func labelRotation(_ mid: Double) -> Double {
        (mid > 90 && mid < 270) ? mid + 180 : mid
    }

    private func labelOffset(_ mid: Double) -> CGSize {
        // Radius 150 wheel; labels sit at r=87 (58/100 of the 150pt radius,
        // matching the web's labelR 58 in a 100-radius viewBox).
        let r = 87.0
        let rad = mid * .pi / 180
        return CGSize(width: r * sin(rad), height: -r * cos(rad))
    }

    private func spin() {
        guard !spinning, !members.isEmpty else { return }
        spinning = true

        // Random resting rotation with several full turns of drama, landing a
        // slice CENTER exactly under the pointer (same math as the web).
        let n = members.count
        let target = Int.random(in: 0..<n)
        let turns = Int.random(in: 5...7)
        let finalRotation = WheelMath.spinRotation(target: target, count: n, turns: turns)
        let decided = members[WheelMath.winnerIndex(rotation: finalRotation, count: n)]

        withAnimation(.timingCurve(0.17, 0.67, 0.12, 0.99, duration: Self.spinSeconds)) {
            rotation = finalRotation
        }

        // Fire on a timer matching the animation (the web does the same rather
        // than trusting transition-end events).
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64((Self.spinSeconds + 0.15) * 1_000_000_000))
            winner = decided
            spinning = false
            onDecided(decided)
        }
    }
}

// A pie slice between two clockwise-from-top angles, in a centered circle.
private struct WheelSlice: Shape {
    let startDegrees: Double
    let endDegrees: Double

    func path(in rect: CGRect) -> Path {
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let radius = min(rect.width, rect.height) / 2
        var path = Path()
        // Convert "clockwise from 12 o'clock" to standard angles (from +x axis).
        let start = Angle(degrees: startDegrees - 90)
        let end = Angle(degrees: endDegrees - 90)
        path.move(to: center)
        path.addArc(center: center, radius: radius,
                    startAngle: start, endAngle: end, clockwise: false)
        path.closeSubpath()
        return path
    }
}

// MARK: - the live vote

private struct VoteStage: View {
    let clubId: UUID
    let selection: Selection
    let members: [Member]
    let onDecided: (Member) -> Void

    @Environment(SessionStore.self) private var session
    @Environment(ToastCenter.self) private var toasts

    @State private var votes: [SelectionVote] = []
    @State private var bag = RealtimeBag()
    @State private var closing = false

    private var isCreator: Bool { selection.createdBy == session.userId }

    private var tally: [UUID: Int] {
        var out: [UUID: Int] = [:]
        for v in votes { out[v.candidateId, default: 0] += 1 }
        return out
    }

    private var myVote: UUID? {
        votes.first { $0.voterId == session.userId }?.candidateId
    }

    var body: some View {
        VStack(spacing: 12) {
            Text("tap a member to cast (or change) your vote.")
                .font(Theme.displayFont(14))
                .foregroundStyle(Theme.textMuted)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(members) { member in
                    voteChip(member)
                }
            }

            if isCreator {
                Button(closing ? "closing\u{2026}" : "Close vote & crown winner") { closeVote() }
                    .buttonStyle(.primary)
                    .disabled(closing)
            } else {
                Text("waiting for the host to close the vote\u{2026}")
                    .font(Theme.monoFont(12))
                    .foregroundStyle(Theme.textMuted)
            }
        }
        .task {
            await refresh()
            let reload: @MainActor () -> Void = {
                bag.schedule(after: 150) { await refresh() }
            }
            bag.add(await API.subscribe(
                channelName: "votes-\(selection.id.uuidString.lowercased())",
                table: "selection_votes",
                filter: "selection_id=eq.\(selection.id.uuidString.lowercased())",
                onChange: reload))
        }
        .onDisappear { bag.cancelAll() }
    }

    private func voteChip(_ member: Member) -> some View {
        let count = tally[member.userId] ?? 0
        let mine = myVote == member.userId
        return Button {
            cast(member)
        } label: {
            HStack(spacing: 8) {
                AvatarView(profile: member.profile, size: 36)
                Text(member.displayName)
                    .font(Theme.displaySemiBold(14))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Text("\(count)")
                    .font(Theme.monoMedium(15))
                    .foregroundStyle(mine ? Color.white : Theme.textMuted)
                    .frame(width: 26, height: 26)
                    .background(Circle().fill(mine ? Theme.yarnSage : Theme.surface2))
            }
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.surface))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(mine ? Theme.yarnSage : Theme.yarnBark, lineWidth: mine ? 2.5 : 1.5)
            )
        }
        .buttonStyle(.plain)
    }

    private func refresh() async {
        votes = (try? await API.selectionVotes(selection.id)) ?? votes
    }

    private func cast(_ member: Member) {
        Task {
            do {
                try await API.castVote(selectionId: selection.id, candidateId: member.userId)
                await refresh()
            } catch {
                toasts.error(error)
            }
        }
    }

    private func closeVote() {
        guard !closing else { return }
        closing = true
        Task {
            defer { closing = false }
            do {
                let votes = try await API.selectionVotes(selection.id)
                guard !votes.isEmpty else {
                    toasts.show("No votes cast yet", .error)
                    return
                }
                var tally: [UUID: Int] = [:]
                for v in votes { tally[v.candidateId, default: 0] += 1 }
                guard let winnerId = tally.max(by: { $0.value < $1.value })?.key,
                      let winner = members.first(where: { $0.userId == winnerId }) else { return }
                try await API.decideSelection(selection.id, resultUserId: winnerId)
                bag.cancelAll()
                onDecided(winner)
            } catch {
                toasts.error(error)
            }
        }
    }
}
