import SwiftUI

public struct SettingsView: View {
    @ObservedObject private var viewModel: MenuBarViewModel

    public init(viewModel: MenuBarViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        DisclosureGroup("菜单栏设置") {
            VStack(alignment: .leading, spacing: 8) {
                if let preferences = viewModel.preferences {
                    viewModeRow(preferences.defaultView)
                    statusDisplayRow(preferences.statusDisplay)
                    refreshRow(preferences.refreshSeconds)
                    thresholdRow(preferences.thresholds)
                    savingRow
                } else {
                    Text("设置读取中。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.top, 6)
        }
        .font(.caption)
    }

    private func viewModeRow(_ defaultView: String) -> some View {
        HStack {
            Text("默认视图")
            Spacer()
            ForEach(MenubarDisplayMode.allCases, id: \.rawValue) { mode in
                Button(ClipulseFormatters.settingsViewLabel(mode.rawValue)) {
                    Task {
                        await viewModel.updateDefaultView(mode.rawValue)
                    }
                }
                .disabled(mode.rawValue == defaultView || viewModel.isSavingPreferences)
            }
        }
    }

    private func statusDisplayRow(_ statusDisplay: String) -> some View {
        HStack {
            Text("菜单栏标题")
            Spacer()
            ForEach(MenubarStatusDisplay.allCases, id: \.rawValue) { mode in
                Button(ClipulseFormatters.statusDisplayLabel(mode.rawValue)) {
                    Task {
                        await viewModel.updateStatusDisplay(mode.rawValue)
                    }
                }
                .disabled(mode.rawValue == statusDisplay || viewModel.isSavingPreferences)
            }
        }
    }

    private func refreshRow(_ refreshSeconds: Int) -> some View {
        HStack {
            Text("刷新间隔")
            Spacer()
            Button("-") {
                Task {
                    await viewModel.adjustRefreshSeconds(by: -15)
                }
            }
            .disabled(viewModel.isSavingPreferences)
            Text("\(refreshSeconds)s")
                .font(.caption.monospacedDigit())
                .frame(width: 44)
            Button("+") {
                Task {
                    await viewModel.adjustRefreshSeconds(by: 15)
                }
            }
            .disabled(viewModel.isSavingPreferences)
        }
    }

    private func thresholdRow(_ thresholds: MenubarThresholds) -> some View {
        HStack {
            Text("阈值")
            Spacer()
            Text("注意 \(thresholds.warningPercent)% · 严重 \(thresholds.criticalPercent)%")
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    @ViewBuilder
    private var savingRow: some View {
        if viewModel.isSavingPreferences {
            Label("设置保存中", systemImage: "arrow.triangle.2.circlepath")
                .foregroundStyle(.secondary)
        }
    }
}
