import Foundation

private let formatterKnownProviderLabels = [
    "codex": "Codex",
    "claude-code": "Claude Code",
    "gemini-cli": "Gemini CLI",
    "opencode": "OpenCode",
]
private let formatterAllowedProviderIDs = Set([
    "antigravity",
    "anthropic",
    "codex",
    "cursor",
    "claude-code",
    "gemini-cli",
    "github-copilot",
    "minimax",
    "opencode",
    "openrouter",
    "synthetic",
    "z-ai",
])
private let formatterSafeProviderIDCharacters = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789-")
private let formatterCredentialLikeProviderIDPrefixes = [
    "api-key",
    "apikey",
    "auth-token",
    "bearer",
    "credential",
    "secret",
    "sk",
    "token",
]
private let formatterHostLikeProviderIDValues = Set([
    "endpoint",
    "gateway",
    "host",
    "internal",
    "intranet",
    "local",
    "localhost",
    "loopback",
    "proxy",
    "server",
])
private let formatterHostLikeProviderIDPrefixes = [
    "api",
    "endpoint",
    "gateway",
    "host",
    "internal",
    "intranet",
    "local",
    "localhost",
    "proxy",
    "server",
]
private let formatterHostLikeProviderIDParts = Set([
    "app",
    "cloud",
    "com",
    "dev",
    "host",
    "http",
    "https",
    "internal",
    "io",
    "net",
    "org",
    "url",
    "www",
])

public enum ClipulseFormatters {
    public static func tokens(_ value: Int) -> String {
        if value >= 1_000_000 {
            return String(format: "%.1fm", Double(value) / 1_000_000)
        }
        if value >= 1_000 {
            return String(format: "%.1fk", Double(value) / 1_000)
        }
        return "\(value)"
    }

    public static func currencyUSD(_ value: Double) -> String {
        if value == 0 {
            return "$0.00"
        }
        return String(format: "$%.2f", value)
    }

    public static func duration(_ seconds: Int) -> String {
        let minutes = max(seconds / 60, 0)
        if minutes >= 60 {
            let hours = minutes / 60
            let remainingMinutes = minutes % 60
            return "\(hours)h \(remainingMinutes)m"
        }
        return "\(minutes)m"
    }

    public static func statusLabel(_ value: String) -> String {
        switch value {
        case "healthy":
            return "正常"
        case "warning":
            return "注意"
        case "danger":
            return "风险"
        case "critical":
            return "严重"
        case "offline":
            return "离线"
        case "unknown":
            return "未知"
        default:
            return value
        }
    }

    public static func statusSymbolName(_ value: String) -> String {
        switch value {
        case "healthy":
            return "waveform.path.ecg"
        case "warning":
            return "exclamationmark.circle"
        case "danger", "critical":
            return "exclamationmark.triangle"
        case "offline":
            return "wifi.slash"
        case "unknown":
            return "circle.dashed"
        default:
            return "waveform.path.ecg"
        }
    }

    public static func settingsViewLabel(_ value: String) -> String {
        switch value {
        case "minimal":
            return "极简"
        case "standard":
            return "标准"
        case "detailed":
            return "详细"
        default:
            return value
        }
    }

    public static func statusDisplayLabel(_ value: String) -> String {
        switch value {
        case "iconOnly":
            return "仅图标"
        case "todayTokens":
            return "今日 Token"
        case "todayCost":
            return "今日费用"
        case "topRiskPercent":
            return "风险百分比"
        case "alertCount":
            return "提醒数"
        default:
            return value
        }
    }

    public static func themeLabel(_ value: String) -> String {
        switch value {
        case "system":
            return "跟随系统"
        case "light":
            return "浅色"
        case "dark":
            return "深色"
        default:
            return value
        }
    }

    public static func providerDisplayLabel(providerID: String?, fallback: String = "未知 Provider") -> String {
        guard let providerID, isSafeProviderID(providerID) else {
            return fallback
        }
        return formatterKnownProviderLabels[providerID] ?? providerID
    }

    public static func topRiskDisplayStatus(_ risk: MenubarTopRisk) -> String {
        guard let providerId = risk.providerId, isSafeProviderID(providerId) else {
            return "unknown"
        }
        return risk.status
    }

    public static func topRiskDisplayUsagePercent(_ risk: MenubarTopRisk) -> Double? {
        guard let providerId = risk.providerId, isSafeProviderID(providerId) else {
            return nil
        }
        return risk.usagePercent
    }

    public static func isSafeProviderID(_ providerID: String) -> Bool {
        guard (1...64).contains(providerID.count) else {
            return false
        }
        guard providerID.trimmingCharacters(in: .whitespacesAndNewlines) == providerID else {
            return false
        }
        guard providerID.rangeOfCharacter(from: formatterSafeProviderIDCharacters.inverted) == nil else {
            return false
        }
        guard !providerID.hasPrefix("-") else {
            return false
        }
        guard !providerID.hasSuffix("-") else {
            return false
        }
        guard !formatterCredentialLikeProviderIDPrefixes.contains(where: { prefix in
            providerID == prefix || providerID.hasPrefix("\(prefix)-")
        }) else {
            return false
        }
        guard !formatterHostLikeProviderIDValues.contains(providerID) else {
            return false
        }
        guard !formatterHostLikeProviderIDPrefixes.contains(where: { prefix in
            providerID.hasPrefix("\(prefix)-")
        }) else {
            return false
        }
        if formatterAllowedProviderIDs.contains(providerID) {
            return true
        }
        return isSafeFutureProviderID(providerID)
    }

    private static func isSafeFutureProviderID(_ providerID: String) -> Bool {
        guard providerID.hasSuffix("-provider") else {
            return false
        }
        let suffixLength = "-provider".count
        let base = String(providerID.dropLast(suffixLength))
        guard !base.isEmpty else {
            return false
        }
        let parts = base.split(separator: "-").map(String.init)
        guard parts.contains(where: containsASCIIAlphabet) else {
            return false
        }
        guard !parts.allSatisfy({ Int($0) != nil }) else {
            return false
        }
        return !parts.contains { formatterHostLikeProviderIDParts.contains($0) }
    }

    private static func containsASCIIAlphabet(_ value: String) -> Bool {
        value.rangeOfCharacter(from: CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz")) != nil
    }

    public static func percent(_ value: Double?) -> String {
        guard let value else {
            return "未知"
        }
        return String(format: "%.0f%%", value)
    }

    public static func remaining(_ seconds: Int?) -> String {
        guard let seconds else {
            return "重置时间未知"
        }
        return "\(duration(seconds)) 后重置"
    }
}
