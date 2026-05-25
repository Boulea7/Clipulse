import AppKit
import Foundation

@MainActor
public final class MenuBarViewModel: ObservableObject {
    @Published public private(set) var summary: MenubarSummary?
    @Published public private(set) var preferences: MenubarPreferences?
    @Published public private(set) var isLoading = false
    @Published public private(set) var isSavingPreferences = false
    @Published public private(set) var errorMessage: String?

    private let client: ClipulseAPIClient
    private var pollTimer: Timer?
    private var savingPreferences: MenubarPreferences?
    private var pendingPreferences: MenubarPreferences?

    public init(client: ClipulseAPIClient = ClipulseAPIClient()) {
        self.client = client
    }

    deinit {
        pollTimer?.invalidate()
    }

    public var menuBarSystemImage: String {
        ClipulseFormatters.statusSymbolName(summary?.status ?? "offline")
    }

    public var dashboardURL: URL {
        client.dashboardURL
    }

    public func loadInitial() async {
        await refreshPreferences()
        await refreshSummary()
        restartPolling()
    }

    public func refreshNow() async {
        await loadSummary(useRefreshEndpoint: true)
    }

    public func refreshSummary() async {
        await loadSummary(useRefreshEndpoint: false)
    }

    public func savePreferences(_ nextPreferences: MenubarPreferences) async {
        guard !isSavingPreferences else {
            pendingPreferences = nextPreferences
            return
        }
        isSavingPreferences = true
        defer {
            savingPreferences = nil
            pendingPreferences = nil
            isSavingPreferences = false
        }

        var preferencesToSave: MenubarPreferences? = nextPreferences
        while let currentPreferences = preferencesToSave {
            savingPreferences = currentPreferences
            pendingPreferences = nil

            do {
                preferences = try await client.updatePreferences(currentPreferences)
                errorMessage = nil
                restartPolling()
            } catch {
                errorMessage = error.localizedDescription
            }

            preferencesToSave = pendingPreferences
        }
    }

    public func updateDefaultView(_ defaultView: String) async {
        var nextPreferences = latestEditablePreferences
        nextPreferences.defaultView = defaultView
        await savePreferences(nextPreferences)
    }

    public func updateRefreshSeconds(_ refreshSeconds: Int) async {
        var nextPreferences = latestEditablePreferences
        nextPreferences.refreshSeconds = min(max(refreshSeconds, 15), 3_600)
        await savePreferences(nextPreferences)
    }

    public func adjustRefreshSeconds(by deltaSeconds: Int) async {
        var nextPreferences = latestEditablePreferences
        nextPreferences.refreshSeconds = min(max(nextPreferences.refreshSeconds + deltaSeconds, 15), 3_600)
        await savePreferences(nextPreferences)
    }

    public func openDashboard() {
        NSWorkspace.shared.open(client.dashboardURL)
    }

    public func quit() {
        NSApplication.shared.terminate(nil)
    }

    private func refreshPreferences() async {
        do {
            preferences = try await client.fetchPreferences()
            errorMessage = nil
        } catch {
            preferences = preferences ?? .fallback
            errorMessage = error.localizedDescription
        }
    }

    private var latestEditablePreferences: MenubarPreferences {
        pendingPreferences ?? savingPreferences ?? preferences ?? .fallback
    }

    private func loadSummary(useRefreshEndpoint: Bool) async {
        guard !isLoading else {
            return
        }
        isLoading = true
        defer { isLoading = false }

        do {
            summary = useRefreshEndpoint ? try await client.refreshSummary() : try await client.fetchSummary()
            errorMessage = nil
        } catch {
            summary = summary?.markedOfflineStale()
            errorMessage = error.localizedDescription
        }
    }

    private func restartPolling() {
        pollTimer?.invalidate()
        let activePreferences = preferences ?? .fallback
        guard activePreferences.enabled else {
            return
        }
        let interval = TimeInterval(min(max(activePreferences.refreshSeconds, 15), 3_600))
        pollTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.refreshSummary()
            }
        }
    }
}

private extension MenubarSummary {
    func markedOfflineStale() -> MenubarSummary {
        var copy = self
        copy.status = "offline"
        copy.stale = true
        return copy
    }
}
