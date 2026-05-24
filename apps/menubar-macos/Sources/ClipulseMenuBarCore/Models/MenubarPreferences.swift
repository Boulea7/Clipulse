import Foundation

public struct MenubarPreferences: Codable, Equatable {
    public var version: Int
    public var enabled: Bool
    public var refreshSeconds: Int
    public var defaultView: String
    public var visibleMetrics: [String]
    public var providerOrder: [String]
    public var thresholds: MenubarThresholds

    public static let fallback = MenubarPreferences(
        version: 1,
        enabled: true,
        refreshSeconds: 60,
        defaultView: "standard",
        visibleMetrics: ["tokens", "costUSD", "activeSeconds", "topRisk"],
        providerOrder: ["codex", "claude-code", "gemini-cli", "opencode"],
        thresholds: MenubarThresholds(warningPercent: 70, criticalPercent: 90)
    )
}

public struct MenubarThresholds: Codable, Equatable {
    public var warningPercent: Int
    public var criticalPercent: Int
}
