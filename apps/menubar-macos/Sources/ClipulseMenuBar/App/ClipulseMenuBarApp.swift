import AppKit
import ClipulseMenuBarCore
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
    }
}

@main
struct ClipulseMenuBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var viewModel = MenuBarViewModel()

    var body: some Scene {
        MenuBarExtra {
            MenuBarContentView(viewModel: viewModel)
                .preferredColorScheme(preferredColorScheme(for: viewModel.preferences?.themeMode))
                .task {
                    await viewModel.loadInitial()
                }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: viewModel.menuBarSystemImage)
                if let title = viewModel.menuBarTitleText {
                    Text(title)
                        .font(.caption.monospacedDigit())
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            .accessibilityLabel(viewModel.menuBarAccessibilityLabel)
        }
        .menuBarExtraStyle(.window)
    }

    private func preferredColorScheme(for theme: MenubarThemeMode?) -> ColorScheme? {
        switch theme {
        case .light:
            return .light
        case .dark:
            return .dark
        case .system, nil:
            return nil
        }
    }
}
