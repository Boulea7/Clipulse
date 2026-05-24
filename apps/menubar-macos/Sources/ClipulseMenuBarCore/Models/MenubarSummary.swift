import Foundation

public struct MenubarSummary: Codable, Equatable {
    public var version: Int
    public var status: String
    public var generatedAt: String
    public var stale: Bool
    public var today: MenubarTodaySummary
    public var currentSession: MenubarCurrentSession
    public var activeBlock: MenubarActiveBlock
    public var topRisk: MenubarTopRisk
    public var providers: [MenubarProviderSummary]
    public var spool: MenubarSpoolSummary
    public var alerts: [MenubarAlert]
}

public struct MenubarTodaySummary: Codable, Equatable {
    public var activeSeconds: Int
    public var waitSeconds: Int
    public var tokens: Int
    public var costUSD: Double
    public var sessions: Int
    public var projects: Int
}

public struct MenubarCurrentSession: Codable, Equatable {
    public var isActive: Bool
    public var source: String?
    public var provider: String?
    public var model: String?
    public var projectLabel: String?
    public var startedAt: String?
    public var activeSeconds: Int
    public var tokens: Int
    public var costUSD: Double
}

public struct MenubarActiveBlock: Codable, Equatable {
    public var isActive: Bool
    public var tokens: Int
    public var limit: Int?
    public var usagePercent: Double?
    public var burnRateTokensPerMinute: Double?
    public var projectedTokens: Int?
    public var resetAt: String?
    public var remainingSeconds: Int?
}

public struct MenubarTopRisk: Codable, Equatable {
    public var providerId: String?
    public var label: String?
    public var status: String
    public var usagePercent: Double?
    public var resetAt: String?
    public var remainingSeconds: Int?
}

public struct MenubarProviderSummary: Codable, Equatable, Identifiable {
    public var id: String
    public var label: String
    public var status: String
    public var usagePercent: Double?
    public var tokensToday: Int
    public var costTodayUSD: Double
    public var resetAt: String?
    public var sparkline: [Double]
}

public struct MenubarSpoolSummary: Codable, Equatable {
    public var pending: Int
    public var failed: Int
}

public struct MenubarAlert: Codable, Equatable, Identifiable {
    public var id: String
    public var level: String?
    public var message: String?

    public init(id: String = UUID().uuidString, level: String? = nil, message: String? = nil) {
        self.id = id
        self.level = level
        self.message = message
    }

    public init(from decoder: Decoder) throws {
        if let value = try? decoder.singleValueContainer().decode(String.self) {
            id = UUID().uuidString
            level = nil
            message = value
            return
        }

        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        level = try container.decodeIfPresent(String.self, forKey: .level)
        message = try container.decodeIfPresent(String.self, forKey: .message)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encodeIfPresent(level, forKey: .level)
        try container.encodeIfPresent(message, forKey: .message)
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case level
        case message
    }
}
