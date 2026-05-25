import SwiftUI

public struct MenuBarContentView: View {
    @ObservedObject private var viewModel: MenuBarViewModel

    public init(viewModel: MenuBarViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            remoteAPIWarningBanner

            if let summary = viewModel.summary {
                summaryContent(summary, mode: displayMode)
            } else {
                emptyState
            }

            if let error = viewModel.errorMessage {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .lineLimit(2)
            }

            SettingsView(viewModel: viewModel)
            footer
        }
        .padding(16)
        .frame(width: 360)
    }

    private var displayMode: MenubarDisplayMode {
        viewModel.preferences?.displayMode ?? .standard
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: viewModel.menuBarSystemImage)
                .font(.title3)
                .foregroundStyle(.tint)
            VStack(alignment: .leading, spacing: 2) {
                Text("Clipulse")
                    .font(.headline)
                Text(headerSubtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if viewModel.isLoading {
                ProgressView()
                    .controlSize(.small)
            }
        }
    }

    private var headerSubtitle: String {
        if let status = viewModel.summary?.status {
            let staleSuffix = viewModel.summary?.stale == true ? " · 数据可能已过期" : ""
            return "状态：\(ClipulseFormatters.statusLabel(status))\(staleSuffix)"
        }
        return "等待本机 API"
    }

    @ViewBuilder
    private var remoteAPIWarningBanner: some View {
        if let warning = viewModel.remoteAPIWarningText {
            Label(warning, systemImage: "exclamationmark.triangle")
                .font(.caption)
                .foregroundStyle(.orange)
                .fixedSize(horizontal: false, vertical: true)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("还没有本机摘要")
                .font(.subheadline.weight(.semibold))
            Text("请确认 Clipulse API 正在 127.0.0.1 运行，并配置了菜单栏所需的本机 token。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    @ViewBuilder
    private func summaryContent(_ summary: MenubarSummary, mode: MenubarDisplayMode) -> some View {
        switch mode {
        case .minimal:
            CompactTodayView(today: summary.today)
            currentSession(summary.currentSession)
            TopRiskView(risk: summary.topRisk)
        case .standard:
            todayGrid(summary.today)
            currentSession(summary.currentSession)
            ActiveBlockView(block: summary.activeBlock)
            ProviderListView(providers: orderedProviders(summary.providers), limit: 4)
        case .detailed:
            todayGrid(summary.today)
            currentSession(summary.currentSession)
            ActiveBlockView(block: summary.activeBlock)
            TopRiskView(risk: summary.topRisk)
            ProviderListView(providers: orderedProviders(summary.providers), limit: nil)
            AlertsView(alerts: summary.alerts)
            spool(summary.spool)
        }
    }

    private func orderedProviders(_ providers: [MenubarProviderSummary]) -> [MenubarProviderSummary] {
        let safeProviders = providers.filter { ClipulseFormatters.isSafeProviderID($0.id) }
        let visibleProviderIDs = Set(viewModel.preferences?.visibleProviders ?? [])
        let visibleProviders = visibleProviderIDs.isEmpty
            ? safeProviders
            : safeProviders.filter { visibleProviderIDs.contains($0.id) }
        let preferredOrder = viewModel.preferences?.providerOrder ?? []
        guard !preferredOrder.isEmpty else {
            return visibleProviders
        }
        let positionByID = Dictionary(uniqueKeysWithValues: preferredOrder.enumerated().map { ($0.element, $0.offset) })
        return visibleProviders.sorted { lhs, rhs in
            let lhsPosition = positionByID[lhs.id] ?? Int.max
            let rhsPosition = positionByID[rhs.id] ?? Int.max
            if lhsPosition == rhsPosition {
                let lhsLabel = ClipulseFormatters.providerDisplayLabel(providerID: lhs.id, remoteLabel: lhs.label)
                let rhsLabel = ClipulseFormatters.providerDisplayLabel(providerID: rhs.id, remoteLabel: rhs.label)
                return lhsLabel.localizedCaseInsensitiveCompare(rhsLabel) == .orderedAscending
            }
            return lhsPosition < rhsPosition
        }
    }

    private func todayGrid(_ today: MenubarTodaySummary) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            MetricTile(title: "Token", value: ClipulseFormatters.tokens(today.tokens))
            MetricTile(title: "费用", value: ClipulseFormatters.currencyUSD(today.costUSD))
            MetricTile(title: "活跃", value: ClipulseFormatters.duration(today.activeSeconds))
            MetricTile(title: "等待", value: ClipulseFormatters.duration(today.waitSeconds))
        }
    }

    private func currentSession(_ session: MenubarCurrentSession) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(session.isActive ? "当前 session" : "最近活动")
                .font(.subheadline.weight(.semibold))
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(session.model ?? session.provider ?? session.source ?? "没有正在进行的 session")
                        .font(.callout)
                        .lineLimit(1)
                    Text(session.projectLabel ?? "显示标签已按隐私策略处理")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                Text(ClipulseFormatters.tokens(session.tokens))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func spool(_ spool: MenubarSpoolSummary) -> some View {
        HStack {
            Label("待发送 \(spool.pending)", systemImage: "tray")
            Spacer()
            Label("失败 \(spool.failed)", systemImage: "exclamationmark.octagon")
        }
        .font(.caption)
        .foregroundStyle(spool.failed > 0 ? .orange : .secondary)
    }

    private var footer: some View {
        HStack {
            Button {
                Task {
                    await viewModel.refreshNow()
                }
            } label: {
                Label("刷新", systemImage: "arrow.clockwise")
            }

            Button {
                viewModel.openDashboard()
            } label: {
                Label("Dashboard", systemImage: "rectangle.portrait.and.arrow.right")
            }

            Spacer()

            Button {
                viewModel.quit()
            } label: {
                Label("退出", systemImage: "power")
            }
        }
        .buttonStyle(.borderless)
        .labelStyle(.titleAndIcon)
    }
}

private struct MetricTile: View {
    var title: String
    var value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title3.monospacedDigit().weight(.semibold))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}
