// Realtime subscriptions (port of api.js subscribe()). The web router tears
// every subscription down via onCleanup() before each render; the native
// equivalent is a token the owning view model cancels in onDisappear (or on
// deinit as a safety net). Each token owns its channel + listener task.

import Foundation
import Supabase

// One live postgres_changes subscription. Cancel is idempotent and safe to
// call from any thread; it detaches the listener task and removes the channel.
final class RealtimeToken: @unchecked Sendable {
    private let channel: RealtimeChannelV2
    private var listener: Task<Void, Never>?
    private let lock = NSLock()

    fileprivate init(channel: RealtimeChannelV2, listener: Task<Void, Never>) {
        self.channel = channel
        self.listener = listener
    }

    func cancel() {
        lock.lock()
        let task = listener
        listener = nil
        lock.unlock()
        guard let task else { return }
        task.cancel()
        let ch = channel
        Task { await supabase.removeChannel(ch) }
    }

    deinit { cancel() }
}

extension API {
    // Subscribe to every change on `table` (optionally filtered, e.g.
    // "book_id=eq.<uuid>"). `onChange` fires on the main actor - views use it
    // to debounce-and-reload exactly like the web feed does.
    static func subscribe(channelName: String,
                          table: String,
                          filter: String? = nil,
                          onChange: @escaping @MainActor () -> Void) async -> RealtimeToken {
        let channel = supabase.channel(channelName)
        let stream = channel.postgresChange(AnyAction.self,
                                            schema: "public",
                                            table: table,
                                            filter: filter)
        await channel.subscribe()
        let listener = Task {
            for await _ in stream {
                if Task.isCancelled { break }
                await MainActor.run { onChange() }
            }
        }
        return RealtimeToken(channel: channel, listener: listener)
    }
}

// A small bag of realtime tokens owned by a view model. Mirrors the web
// router's cleanups array: collect while the screen is alive, cancel all
// before the next lifecycle. Also owns the debounce timer the web feed uses.
@MainActor
final class RealtimeBag {
    private var tokens: [RealtimeToken] = []
    private var debounce: Task<Void, Never>?

    func add(_ token: RealtimeToken) {
        tokens.append(token)
    }

    // Debounced trigger (the web uses 400ms) so bursts of realtime events
    // collapse into one reload.
    func schedule(after milliseconds: Int = 400, _ action: @escaping @MainActor () async -> Void) {
        debounce?.cancel()
        debounce = Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(milliseconds) * 1_000_000)
            guard !Task.isCancelled else { return }
            await action()
        }
    }

    func cancelAll() {
        debounce?.cancel()
        debounce = nil
        for t in tokens { t.cancel() }
        tokens.removeAll()
    }

    deinit {
        debounce?.cancel()
        for t in tokens { t.cancel() }
    }
}
