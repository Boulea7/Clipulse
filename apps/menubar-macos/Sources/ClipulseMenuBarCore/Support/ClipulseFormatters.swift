import Foundation

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
