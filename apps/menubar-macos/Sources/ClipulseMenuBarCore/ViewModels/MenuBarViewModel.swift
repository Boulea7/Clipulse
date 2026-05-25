import AppKit
import Foundation

private let menuBarCostCapUSD = 999.0
private let menuBarAlertCountCap = 99
private let knownProviderOrder = ["codex", "claude-code", "gemini-cli", "opencode"]

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

    public var menuBarAccessibilityLabel: String {
        let status = ClipulseFormatters.statusLabel(summary?.status ?? "offline")
        let staleSuffix = summary?.stale == true ? "，数据可能已过期" : ""
        let titleSuffix = menuBarTitleAccessibilityText.map { "，显示：\($0)" } ?? ""
        return "Clipulse，状态：\(status)\(staleSuffix)\(titleSuffix)"
    }

    public var menuBarTitleAccessibilityText: String? {
        guard let summary else {
            return nil
        }

        switch preferences?.statusDisplayMode ?? .iconOnly {
        case .iconOnly:
            return nil
        case .todayTokens:
            return "\(ClipulseFormatters.tokens(summary.today.tokens)) Token"
        case .todayCost:
            return boundedCostText(summary.today.costUSD)
        case .topRiskPercent:
            guard let usagePercent = safeTopRiskUsagePercent(summary.topRisk) else {
                return nil
            }
            return "风险 \(ClipulseFormatters.percent(usagePercent))"
        case .alertCount:
            return boundedAlertCountAccessibilityText(summary.alerts.count)
        }
    }

    public var menuBarTitleText: String? {
        guard let summary else {
            return nil
        }

        switch preferences?.statusDisplayMode ?? .iconOnly {
        case .iconOnly:
            return nil
        case .todayTokens:
            return ClipulseFormatters.tokens(summary.today.tokens)
        case .todayCost:
            return boundedCostText(summary.today.costUSD)
        case .topRiskPercent:
            guard let usagePercent = safeTopRiskUsagePercent(summary.topRisk) else {
                return nil
            }
            return ClipulseFormatters.percent(usagePercent)
        case .alertCount:
            return boundedAlertCountTitle(summary.alerts.count)
        }
    }

    public var dashboardURL: URL {
        client.dashboardURL
    }

    public var remoteAPIWarningText: String? {
        guard client.allowsRemoteAPI else {
            return nil
        }
        let host = client.apiBaseURL.host ?? client.apiBaseURL.absoluteString
        return "已允许远程 API；如果配置了 Token，菜单栏会把 Authorization header 发往 \(host)。"
    }

    public var providerPreferenceItems: [MenubarProviderPreferenceItem] {
        let preferences = latestEditablePreferences
        let order = normalizedProviderOrder(candidateProviderIDs(from: preferences))
        let visibleProviderIDs = normalizedVisibleProviderIDs(
            preferences.visibleProviders,
            fallbackOrder: order
        )
        let visibleCount = visibleProviderIDs.count
        return order.enumerated().map { index, providerID in
            MenubarProviderPreferenceItem(
                id: providerID,
                label: providerLabel(providerID),
                isVisible: visibleProviderIDs.contains(providerID),
                canHide: visibleCount > 1,
                canMoveUp: index > 0,
                canMoveDown: index < order.count - 1
            )
        }
    }

    private func boundedCostText(_ costUSD: Double) -> String {
        if costUSD > menuBarCostCapUSD {
            return "$999+"
        }
        return ClipulseFormatters.currencyUSD(costUSD)
    }

    private func boundedAlertCountTitle(_ count: Int) -> String? {
        guard count > 0 else {
            return nil
        }
        if count > menuBarAlertCountCap {
            return "!99+"
        }
        return "!\(count)"
    }

    private func boundedAlertCountAccessibilityText(_ count: Int) -> String? {
        guard count > 0 else {
            return nil
        }
        if count > menuBarAlertCountCap {
            return "99 条以上提醒"
        }
        return "\(count) 条提醒"
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

    public func updateStatusDisplay(_ statusDisplay: String) async {
        var nextPreferences = latestEditablePreferences
        nextPreferences.statusDisplay = statusDisplay
        await savePreferences(nextPreferences)
    }

    public func updateTheme(_ theme: String) async {
        var nextPreferences = latestEditablePreferences
        nextPreferences.theme = theme
        await savePreferences(nextPreferences)
    }

    public func setProviderVisibility(_ providerID: String, isVisible: Bool) async {
        guard ClipulseFormatters.isSafeProviderID(providerID) else {
            return
        }
        var nextPreferences = latestEditablePreferences
        let order = normalizedProviderOrder(candidateProviderIDs(from: nextPreferences))
        var visibleProviderIDs = normalizedVisibleProviderIDs(
            nextPreferences.visibleProviders,
            fallbackOrder: order
        )

        if isVisible {
            visibleProviderIDs.insert(providerID)
        } else if visibleProviderIDs.count > 1 {
            visibleProviderIDs.remove(providerID)
        }

        nextPreferences.providerOrder = order
        nextPreferences.visibleProviders = order.filter { visibleProviderIDs.contains($0) }
        await savePreferences(nextPreferences)
    }

    public func moveProvider(_ providerID: String, direction: MenubarProviderMoveDirection) async {
        guard ClipulseFormatters.isSafeProviderID(providerID) else {
            return
        }
        var nextPreferences = latestEditablePreferences
        var order = normalizedProviderOrder(candidateProviderIDs(from: nextPreferences))
        guard let index = order.firstIndex(of: providerID) else {
            return
        }

        switch direction {
        case .up:
            guard index > 0 else {
                return
            }
            order.swapAt(index, index - 1)
        case .down:
            guard index < order.count - 1 else {
                return
            }
            order.swapAt(index, index + 1)
        }

        let visibleProviderIDs = normalizedVisibleProviderIDs(
            nextPreferences.visibleProviders,
            fallbackOrder: order
        )
        nextPreferences.providerOrder = order
        nextPreferences.visibleProviders = order.filter { visibleProviderIDs.contains($0) }
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

    private func candidateProviderIDs(from preferences: MenubarPreferences) -> [String] {
        preferences.providerOrder
            + preferences.visibleProviders
            + (summary?.providers.map(\.id) ?? [])
            + knownProviderOrder
    }

    private func normalizedProviderOrder(_ providerIDs: [String]) -> [String] {
        var order: [String] = []
        for providerID in providerIDs where ClipulseFormatters.isSafeProviderID(providerID) && !order.contains(providerID) {
            order.append(providerID)
        }
        for providerID in knownProviderOrder where !order.contains(providerID) {
            order.append(providerID)
        }
        return order
    }

    private func normalizedVisibleProviderIDs(_ providerIDs: [String], fallbackOrder: [String]) -> Set<String> {
        let visibleIDs = providerIDs.filter { ClipulseFormatters.isSafeProviderID($0) }
        if visibleIDs.isEmpty {
            return Set(fallbackOrder)
        }
        return Set(visibleIDs)
    }

    private func providerLabel(_ providerID: String) -> String {
        return ClipulseFormatters.providerDisplayLabel(providerID: providerID, fallback: providerID)
    }

    private func safeTopRiskUsagePercent(_ risk: MenubarTopRisk) -> Double? {
        guard let providerId = risk.providerId, ClipulseFormatters.isSafeProviderID(providerId) else {
            return nil
        }
        return risk.usagePercent
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
