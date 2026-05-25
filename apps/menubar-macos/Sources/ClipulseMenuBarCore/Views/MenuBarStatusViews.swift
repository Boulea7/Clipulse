import SwiftUI

struct CompactTodayView: View {
    var today: MenubarTodaySummary

    var body: some View {
        HStack(spacing: 10) {
            compactMetric("Token", ClipulseFormatters.tokens(today.tokens))
            Divider()
            compactMetric("费用", ClipulseFormatters.currencyUSD(today.costUSD))
            Divider()
            compactMetric("活跃", ClipulseFormatters.duration(today.activeSeconds))
        }
        .padding(10)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func compactMetric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.callout.monospacedDigit().weight(.semibold))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct ActiveBlockView: View {
    var block: MenubarActiveBlock

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(block.isActive ? "当前 block" : "Block", systemImage: block.isActive ? "timer" : "timer.circle")
                Spacer()
                Text(ClipulseFormatters.percent(block.usagePercent))
                    .font(.caption.monospacedDigit().weight(.medium))
                    .foregroundStyle(.secondary)
            }
            .font(.subheadline.weight(.semibold))

            if let usagePercent = block.usagePercent {
                ProgressView(value: min(max(usagePercent, 0), 100), total: 100)
                    .accessibilityLabel("Block 使用率 \(ClipulseFormatters.percent(usagePercent))")
            }

            HStack {
                Text("\(ClipulseFormatters.tokens(block.tokens)) Token")
                Spacer()
                Text(ClipulseFormatters.remaining(block.remainingSeconds))
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(12)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

struct TopRiskView: View {
    var risk: MenubarTopRisk

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: ClipulseFormatters.statusSymbolName(topRiskDisplayStatus(risk)))
                .foregroundStyle(statusColor)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(topRiskDisplayLabel(risk))
                    .font(.callout.weight(.medium))
                    .lineLimit(1)
                Text("风险状态：\(ClipulseFormatters.statusLabel(topRiskDisplayStatus(risk))) · \(ClipulseFormatters.percent(topRiskDisplayUsagePercent(risk)))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(topRiskAccessibilityLabel(risk))
    }

    private var statusColor: Color {
        switch topRiskDisplayStatus(risk) {
        case "warning":
            return .orange
        case "danger", "critical":
            return .red
        case "healthy":
            return .green
        default:
            return .secondary
        }
    }
}

func topRiskAccessibilityLabel(_ risk: MenubarTopRisk) -> String {
    let label = topRiskDisplayLabel(risk)
    return "\(label)，风险状态：\(ClipulseFormatters.statusLabel(topRiskDisplayStatus(risk)))，使用率：\(ClipulseFormatters.percent(topRiskDisplayUsagePercent(risk)))"
}

func topRiskDisplayLabel(_ risk: MenubarTopRisk) -> String {
    ClipulseFormatters.providerDisplayLabel(
        providerID: risk.providerId,
        remoteLabel: risk.label,
        fallback: "暂无高风险 Provider"
    )
}

func topRiskDisplayStatus(_ risk: MenubarTopRisk) -> String {
    guard let providerId = risk.providerId, ClipulseFormatters.isSafeProviderID(providerId) else {
        return "unknown"
    }
    return risk.status
}

func topRiskDisplayUsagePercent(_ risk: MenubarTopRisk) -> Double? {
    guard let providerId = risk.providerId, ClipulseFormatters.isSafeProviderID(providerId) else {
        return nil
    }
    return risk.usagePercent
}

struct AlertsView: View {
    var alerts: [MenubarAlert]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("提醒")
                .font(.subheadline.weight(.semibold))

            if alerts.isEmpty {
                Text("没有新的提醒。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(alerts.prefix(3)) { alert in
                    Label(alert.message ?? "Clipulse 提醒", systemImage: alertIcon(alert.level))
                        .font(.caption)
                        .foregroundStyle(alertColor(alert.level))
                        .lineLimit(2)
                }
            }
        }
    }

    private func alertIcon(_ level: String?) -> String {
        switch level {
        case "critical", "danger":
            return "exclamationmark.triangle"
        case "warning":
            return "exclamationmark.circle"
        default:
            return "bell"
        }
    }

    private func alertColor(_ level: String?) -> Color {
        switch level {
        case "critical", "danger":
            return .red
        case "warning":
            return .orange
        default:
            return .secondary
        }
    }
}
