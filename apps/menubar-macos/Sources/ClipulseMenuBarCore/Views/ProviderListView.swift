import SwiftUI

public struct ProviderListView: View {
    private let providers: [MenubarProviderSummary]

    public init(providers: [MenubarProviderSummary]) {
        self.providers = providers
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
                ForEach(providers.prefix(4)) { provider in
                    providerRow(provider)
                }
            }
        }
    }

    private func providerRow(_ provider: MenubarProviderSummary) -> some View {
        HStack(spacing: 8) {
            Circle()
                .fill(statusColor(provider.status))
                .frame(width: 8, height: 8)
            Text(provider.label)
                .lineLimit(1)
            Spacer()
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
