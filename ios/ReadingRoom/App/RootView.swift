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
    // The "Unlocked" space: reactions the spoiler gate opened as I read. nil book
    // = global inbox (feed bell); a bookId = the per-book filter (post-bump banner).
    case unlocked(bookId: UUID?)
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
            case .unlocked(let bookId):
                UnlockedView(bookId: bookId)
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
        case feed, clubs, create, progress, profile
    }

    @State private var tab: Tab = .feed
    @State private var feedPath = NavigationPath()
    @State private var clubsPath = NavigationPath()
    @State private var progressPath = NavigationPath()

    // The "+" compose affordance lives as a real tab item so it matches the other
    // hotbar icons (same sage tint, same label). Selecting it isn't a destination:
    // we intercept the binding, jump to the Feed, and bump this counter to open the
    // compose hub. A plain counter (rather than a Bool) so repeat taps re-fire even
    // if the feed already handled the last one.
    @State private var composeSignal = 0

    // Intercepts a tap on the "Create" tab: never actually select it - switch to
    // the Feed and fire the compose hub instead. Any other tab selects normally.
    private var tabSelection: Binding<Tab> {
        Binding(
            get: { tab },
            set: { newValue in
                if newValue == .create {
                    if tab != .feed { tab = .feed }
                    composeSignal += 1
                } else {
                    tab = newValue
                }
            }
        )
    }

    var body: some View {
        TabView(selection: tabSelection) {
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

            // Not a real destination - selecting it is intercepted by tabSelection
            // to open the compose hub. Content never shows; it exists only so the
            // "+" renders as a native tab item matching the others.
            Color.clear
                .tabItem { Label("Create", systemImage: "plus.circle") }
                .tag(Tab.create)

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
    }
}
