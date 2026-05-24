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
                    refreshRow(preferences.refreshSeconds)
                    thresholdRow(preferences.thresholds)
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
            ForEach(["minimal", "standard", "detailed"], id: \.self) { value in
                Button(ClipulseFormatters.settingsViewLabel(value)) {
                    Task {
                        await viewModel.updateDefaultView(value)
                    }
                }
                .disabled(value == defaultView)
            }
        }
    }

    private func refreshRow(_ refreshSeconds: Int) -> some View {
        HStack {
            Text("刷新间隔")
            Spacer()
            Button("-") {
                Task {
                    await viewModel.updateRefreshSeconds(refreshSeconds - 15)
                }
            }
            Text("\(refreshSeconds)s")
                .font(.caption.monospacedDigit())
                .frame(width: 44)
            Button("+") {
                Task {
                    await viewModel.updateRefreshSeconds(refreshSeconds + 15)
                }
            }
        }
    }

    private func thresholdRow(_ thresholds: MenubarThresholds) -> some View {
        HStack {
            Text("阈值")
            Spacer()
            Text("warning \(thresholds.warningPercent)% · critical \(thresholds.criticalPercent)%")
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}
