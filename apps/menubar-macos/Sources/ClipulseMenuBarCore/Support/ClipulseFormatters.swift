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
}
