import Foundation

public struct MenubarPreferences: Codable, Equatable {
    public var version: Int
    public var enabled: Bool
    public var refreshSeconds: Int
    public var defaultView: String
    public var statusDisplay: String
    public var visibleMetrics: [String]
    public var visibleProviders: [String]
    public var providerOrder: [String]
    public var thresholds: MenubarThresholds
    public var theme: String

    public var displayMode: MenubarDisplayMode {
        MenubarDisplayMode(rawValue: defaultView) ?? .standard
    }

    public var statusDisplayMode: MenubarStatusDisplay {
        MenubarStatusDisplay(rawValue: statusDisplay) ?? .iconOnly
    }

    public init(
        version: Int,
        enabled: Bool,
        refreshSeconds: Int,
        defaultView: String,
        statusDisplay: String = "iconOnly",
        visibleMetrics: [String],
        visibleProviders: [String] = ["codex", "claude-code", "gemini-cli", "opencode"],
        providerOrder: [String],
        thresholds: MenubarThresholds,
        theme: String = "system"
    ) {
        self.version = version
        self.enabled = enabled
        self.refreshSeconds = refreshSeconds
        self.defaultView = defaultView
        self.statusDisplay = statusDisplay
        self.visibleMetrics = visibleMetrics
        self.visibleProviders = visibleProviders
        self.providerOrder = providerOrder
        self.thresholds = thresholds
        self.theme = theme
    }

    public static let fallback = MenubarPreferences(
        version: 2,
        enabled: true,
        refreshSeconds: 60,
        defaultView: "standard",
        statusDisplay: "iconOnly",
        visibleMetrics: ["tokens", "costUSD", "activeSeconds", "topRisk"],
        visibleProviders: ["codex", "claude-code", "gemini-cli", "opencode"],
        providerOrder: ["codex", "claude-code", "gemini-cli", "opencode"],
        thresholds: MenubarThresholds(warningPercent: 70, criticalPercent: 90),
        theme: "system"
    )

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decodeIfPresent(Int.self, forKey: .version) ?? 1
        enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
        refreshSeconds = try container.decodeIfPresent(Int.self, forKey: .refreshSeconds) ?? 60
        defaultView = try container.decodeIfPresent(String.self, forKey: .defaultView) ?? "standard"
        statusDisplay = try container.decodeIfPresent(String.self, forKey: .statusDisplay) ?? "iconOnly"
        visibleMetrics = try container.decodeIfPresent([String].self, forKey: .visibleMetrics)
            ?? ["tokens", "costUSD", "activeSeconds", "topRisk"]
        visibleProviders = try container.decodeIfPresent([String].self, forKey: .visibleProviders)
            ?? ["codex", "claude-code", "gemini-cli", "opencode"]
        providerOrder = try container.decodeIfPresent([String].self, forKey: .providerOrder)
            ?? ["codex", "claude-code", "gemini-cli", "opencode"]
        thresholds = try container.decodeIfPresent(MenubarThresholds.self, forKey: .thresholds)
            ?? MenubarThresholds(warningPercent: 70, criticalPercent: 90)
        theme = try container.decodeIfPresent(String.self, forKey: .theme) ?? "system"
    }
}

public struct MenubarThresholds: Codable, Equatable {
    public var warningPercent: Int
    public var criticalPercent: Int
}

public enum MenubarDisplayMode: String, CaseIterable, Equatable {
    case minimal
    case standard
    case detailed
}

public enum MenubarStatusDisplay: String, CaseIterable, Equatable {
    case iconOnly
    case todayTokens
    case todayCost
    case topRiskPercent
    case alertCount
}
