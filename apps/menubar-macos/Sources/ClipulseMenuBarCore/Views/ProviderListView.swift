import SwiftUI

public struct ProviderListView: View {
    private let providers: [MenubarProviderSummary]
    private let limit: Int?

    public init(providers: [MenubarProviderSummary], limit: Int? = 4) {
        self.providers = providers
        self.limit = limit
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Provider")
                .font(.subheadline.weight(.semibold))

            if providers.isEmpty {
                Text("还没有 Provider 摘要。接入 usage 事件后这里会显示 Token、费用和风险状态。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(visibleProviders) { provider in
                    providerRow(provider)
                }
            }
        }
    }

    private var visibleProviders: [MenubarProviderSummary] {
        guard let limit else {
            return providers
        }
        return Array(providers.prefix(limit))
    }

    private func providerRow(_ provider: MenubarProviderSummary) -> some View {
        HStack(spacing: 8) {
            Circle()
                .fill(statusColor(provider.status))
                .frame(width: 8, height: 8)
            Text(provider.label)
                .lineLimit(1)
            Spacer()
            Text(ClipulseFormatters.statusLabel(provider.status))
                .font(.caption2.weight(.medium))
                .foregroundStyle(statusColor(provider.status))
                .accessibilityLabel("Provider 状态 \(ClipulseFormatters.statusLabel(provider.status))")
            Text(ClipulseFormatters.tokens(provider.tokensToday))
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
            Text(ClipulseFormatters.currencyUSD(provider.costTodayUSD))
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .font(.caption)
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "healthy":
            return .green
        case "warning":
            return .orange
        case "danger", "critical":
            return .red
        default:
            return .secondary
        }
    }
}
