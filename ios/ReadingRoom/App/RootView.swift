// The app shell. Auth phase decides login vs the tab UI (port of main.js
// boot + nav). The web's hash routes become value-based NavigationStack
// destinations; the web's bottom tab bar maps 1:1 onto TabView.

import SwiftUI

// The pushable routes (web: /club/:id, /club/:id/picker, /club/:id/history,
// /club/:id/book/:bookId). Feed/clubs/progress/profile are tabs, not routes.
enum Route: Hashable {
    case club(UUID)
    case picker(clubId: UUID)
    case history(clubId: UUID)
    case posts(clubId: UUID)   // the club's lightweight, non-spoiler-gated post feed
    case book(clubId: UUID, bookId: UUID)
    case reader(UUID)   // another reader's read-only profile (with follow control)
    // A reader's PERSONAL involvement with a book (their own reactions/replies/
    // progress), keyed by ownerId + bookId. Reached from a profile shelf tap.
    case bookInvolvement(ownerId: UUID, bookId: UUID)
}

extension View {
    // Shared destination mapping so every tab's stack resolves routes the same.
    func appDestinations() -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case .club(let id):
                ClubView(clubId: id)
            case .picker(let clubId):
                PickerView(clubId: clubId)
            case .history(let clubId):
                HistoryView(clubId: clubId)
            case .posts(let clubId):
                PostsView(clubId: clubId)
            case .book(let clubId, let bookId):
                BookView(clubId: clubId, bookId: bookId)
            case .reader(let userId):
                ProfileView(readerId: userId)
            case .bookInvolvement(let ownerId, let bookId):
                BookInvolvementView(ownerId: ownerId, bookId: bookId)
            }
        }
    }
}

struct RootView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        ZStack(alignment: .top) {
            switch session.phase {
            case .loading:
                splash
            case .signedOut:
                LoginView()
            case .signedIn:
                MainTabView()
            }
            ToastOverlay()
        }
    }

    private var splash: some View {
        VStack(spacing: 14) {
            Text("\u{1F4DA}")
                .font(.system(size: 44))
            StampTitle(text: "The Reading Room")
            ProgressView()
                .tint(Theme.yarnSage)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg.ignoresSafeArea())
    }
}

struct MainTabView: View {
    enum Tab: Hashable {
        case feed, clubs, progress, profile
    }

    @State private var tab: Tab = .feed
    @State private var feedPath = NavigationPath()
    @State private var clubsPath = NavigationPath()
    @State private var progressPath = NavigationPath()

    // The center "+" compose affordance: bumping this asks the Feed to open its
    // compose hub. A plain counter (rather than a Bool) so repeat taps re-fire
    // even if the feed already handled the last one.
    @State private var composeSignal = 0

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack(path: $feedPath) {
                FeedView(composeSignal: composeSignal)
                    .appDestinations()
            }
            .tabItem { Label("Feed", systemImage: "sparkles.rectangle.stack") }
            .tag(Tab.feed)

            NavigationStack(path: $clubsPath) {
                ClubsView()
                    .appDestinations()
            }
            .tabItem { Label("Clubs", systemImage: "books.vertical") }
            .tag(Tab.clubs)

            NavigationStack(path: $progressPath) {
                MyProgressView()
                    .appDestinations()
            }
            .tabItem { Label("Progress", systemImage: "bookmark") }
            .tag(Tab.progress)

            NavigationStack {
                ProfileView()
                    .appDestinations()
            }
            .tabItem { Label("Profile", systemImage: "person.crop.circle") }
            .tag(Tab.profile)
        }
        .tint(Theme.yarnSage)
        // A raised center "+" floating over the tab bar. Tapping it switches to
        // the Feed and opens the compose hub (create post / story / start book).
        .overlay(alignment: .bottom) {
            Button {
                if tab != .feed { tab = .feed }
                composeSignal += 1
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(Theme.surface)
                    .frame(width: 54, height: 54)
                    .background(Circle().fill(Theme.yarnRust))
                    .overlay(Circle().stroke(Theme.bg, lineWidth: 4))
                    .shadow(color: .black.opacity(0.2), radius: 6, y: 3)
            }
            .accessibilityLabel("Create")
            .offset(y: -6)
        }
    }
}
