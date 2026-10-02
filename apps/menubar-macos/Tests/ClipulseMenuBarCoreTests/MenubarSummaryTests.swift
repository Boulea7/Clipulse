import Foundation
import XCTest
@testable import ClipulseMenuBarCore

final class MenubarSummaryTests: XCTestCase {
    func testSummaryPayloadDecodesStableP0Contract() throws {
        let data = Data(Self.summaryJSON.utf8)
        let summary = try JSONDecoder().decode(MenubarSummary.self, from: data)

        XCTAssertEqual(summary.version, 1)
        XCTAssertEqual(summary.status, "healthy")
        XCTAssertEqual(summary.today.tokens, 18_200)
        XCTAssertEqual(summary.today.costUSD, 0.31)
        XCTAssertEqual(summary.currentSession.model, "Sonnet")
        XCTAssertEqual(summary.providers.first?.id, "codex")
        XCTAssertEqual(summary.providers.first?.status, "unknown")
        XCTAssertEqual(summary.providers.first?.tokensToday, 12_400)
        XCTAssertEqual(summary.spool.pending, 0)
        XCTAssertEqual(summary.alerts.first?.message, "quota warning")
    }

    func testSummaryPayloadAllowsRedactedCurrentSessionLabels() throws {
        let redactedJSON = Self.summaryJSON
            .replacingOccurrences(of: "\"Sonnet\"", with: "null")
            .replacingOccurrences(of: "\"Clipulse\"", with: "null")
        let summary = try JSONDecoder().decode(MenubarSummary.self, from: Data(redactedJSON.utf8))

        XCTAssertNil(summary.currentSession.model)
        XCTAssertNil(summary.currentSession.projectLabel)
        XCTAssertEqual(summary.topRisk.status, "unknown")
    }

    func testPreferencesPayloadRoundTripsCamelCaseContract() throws {
        let preferences = MenubarPreferences(
            version: 2,
            enabled: true,
            refreshSeconds: 120,
            defaultView: "minimal",
            statusDisplay: "todayTokens",
            visibleMetrics: ["tokens", "costUSD"],
            visibleProviders: ["codex"],
            providerOrder: ["codex", "claude-code"],
            thresholds: MenubarThresholds(warningPercent: 70, criticalPercent: 90),
            theme: "system"
        )

        let encoded = try JSONEncoder().encode(preferences)
        let decoded = try JSONDecoder().decode(MenubarPreferences.self, from: encoded)

        XCTAssertEqual(decoded, preferences)
        XCTAssertEqual(decoded.displayMode, .minimal)
        XCTAssertEqual(decoded.statusDisplayMode, .todayTokens)
        XCTAssertEqual(decoded.themeMode, .system)
    }

    func testUnknownPreferencesDisplayModeFallsBackToStandard() throws {
        let preferences = MenubarPreferences(
            version: 2,
            enabled: true,
            refreshSeconds: 120,
            defaultView: "sideways",
            statusDisplay: "unknown",
            visibleMetrics: ["tokens", "costUSD"],
            providerOrder: ["codex", "claude-code"],
            thresholds: MenubarThresholds(warningPercent: 70, criticalPercent: 90)
        )

        XCTAssertEqual(preferences.displayMode, .standard)
        XCTAssertEqual(preferences.statusDisplayMode, .iconOnly)
    }

    func testPreferencesDecodeOlderPayloadWithDefaults() throws {
        let payload = """
        {
          "version": 1,
          "enabled": true,
          "refreshSeconds": 60,
          "defaultView": "standard",
          "visibleMetrics": ["tokens"],
          "providerOrder": ["codex"],
          "thresholds": {"warningPercent": 70, "criticalPercent": 90}
        }
        """

        let preferences = try JSONDecoder().decode(MenubarPreferences.self, from: Data(payload.utf8))

        XCTAssertEqual(preferences.statusDisplay, "iconOnly")
        XCTAssertEqual(preferences.visibleProviders, ["codex", "claude-code", "gemini-cli", "opencode"])
        XCTAssertEqual(preferences.theme, "system")
        XCTAssertEqual(preferences.themeMode, .system)
    }

    func testUnknownPreferencesThemeFallsBackToSystem() throws {
        let preferences = MenubarPreferences(
            version: 2,
            enabled: true,
            refreshSeconds: 120,
            defaultView: "standard",
            statusDisplay: "iconOnly",
            visibleMetrics: ["tokens"],
            providerOrder: ["codex"],
            thresholds: MenubarThresholds(warningPercent: 70, criticalPercent: 90),
            theme: "sepia"
        )

        XCTAssertEqual(preferences.themeMode, .system)
    }

    func testStringAlertsDecodeWithStableIDs() throws {
        let payload = #""quota warning""#.data(using: .utf8)!

        let first = try JSONDecoder().decode(MenubarAlert.self, from: payload)
        let second = try JSONDecoder().decode(MenubarAlert.self, from: payload)

        XCTAssertEqual(first.id, second.id)
        XCTAssertEqual(first.message, "quota warning")
    }

    func testObjectAlertsWithoutIDsDecodeWithStableIDs() throws {
        let payload = #"{"level":"warning","message":"quota warning"}"#.data(using: .utf8)!

        let first = try JSONDecoder().decode(MenubarAlert.self, from: payload)
        let second = try JSONDecoder().decode(MenubarAlert.self, from: payload)

        XCTAssertEqual(first.id, second.id)
        XCTAssertEqual(first.level, "warning")
        XCTAssertEqual(first.message, "quota warning")
    }

    func testTopRiskAccessibilityLabelIncludesProviderStatusAndPercent() {
        let risk = MenubarTopRisk(
            providerId: "codex",
            label: "Codex",
            status: "warning",
            usagePercent: 74,
            resetAt: nil,
            remainingSeconds: nil
        )

        XCTAssertEqual(
            topRiskAccessibilityLabel(risk),
            "Codex，风险状态：注意，使用率：74%"
        )
    }

    func testTopRiskDisplayLabelIgnoresUnsafeRemoteLabel() {
        let futureRisk = MenubarTopRisk(
            providerId: "future-provider",
            label: "/private/path",
            status: "warning",
            usagePercent: 74,
            resetAt: nil,
            remainingSeconds: nil
        )
        let unsafeRisk = MenubarTopRisk(
            providerId: "api-key-provider",
            label: "Hidden",
            status: "warning",
            usagePercent: 74,
            resetAt: nil,
            remainingSeconds: nil
        )

        XCTAssertEqual(topRiskDisplayLabel(futureRisk), "future-provider")
        XCTAssertEqual(topRiskDisplayLabel(unsafeRisk), "暂无高风险 Provider")
        XCTAssertEqual(topRiskDisplayStatus(unsafeRisk), "unknown")
        XCTAssertNil(topRiskDisplayUsagePercent(unsafeRisk))
        XCTAssertEqual(
            topRiskAccessibilityLabel(futureRisk),
            "future-provider，风险状态：注意，使用率：74%"
        )
        XCTAssertEqual(
            topRiskAccessibilityLabel(unsafeRisk),
            "暂无高风险 Provider，风险状态：未知，使用率：未知"
        )
    }

    func testProviderDisplayLabelUsesLocalKnownLabelsAndSafeIDsOnly() {
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "codex"),
            "Codex"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "future-provider"),
            "future-provider"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "mistral-cli"),
            "mistral-cli"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "qwen"),
            "qwen"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "openrouter"),
            "openrouter"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "token-like-provider"),
            "未知 Provider"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "api.openai.com"),
            "未知 Provider"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "10.0.0.5"),
            "未知 Provider"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "localhost"),
            "未知 Provider"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "api-gateway"),
            "未知 Provider"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "https-provider"),
            "未知 Provider"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "http-provider"),
            "未知 Provider"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "url-provider"),
            "未知 Provider"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "www-provider"),
            "未知 Provider"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "10-0-0-5-provider"),
            "未知 Provider"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "openai-com-provider"),
            "未知 Provider"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "foo-localhost-provider"),
            "未知 Provider"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "foo-proxy-provider"),
            "未知 Provider"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "foo-api-provider"),
            "未知 Provider"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "foo-token-provider"),
            "未知 Provider"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "foo-secret-provider"),
            "未知 Provider"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: "foo-gateway-provider"),
            "未知 Provider"
        )
        XCTAssertEqual(
            ClipulseFormatters.providerDisplayLabel(providerID: nil),
            "未知 Provider"
        )
    }

    func testProviderFiltersUseSafeVisibilityAndOrder() {
        let providers = [
            MenubarProviderSummary(
                id: "codex",
                label: "/private/path",
                status: "healthy",
                usagePercent: 10,
                tokensToday: 100,
                costTodayUSD: 0.01,
                resetAt: nil,
                sparkline: []
            ),
            MenubarProviderSummary(
                id: "mistral-cli",
                label: "Remote label",
                status: "healthy",
                usagePercent: 20,
                tokensToday: 200,
                costTodayUSD: 0.02,
                resetAt: nil,
                sparkline: []
            ),
            MenubarProviderSummary(
                id: "foo-localhost-provider",
                label: "Unsafe",
                status: "danger",
                usagePercent: 99,
                tokensToday: 999,
                costTodayUSD: 9.99,
                resetAt: nil,
                sparkline: []
            ),
        ]

        XCTAssertEqual(
            MenubarProviderFilters.visibleProviders(
                providers,
                requestedVisibleProviderIDs: ["foo-localhost-provider", "missing"],
                preferredOrder: ["mistral-cli", "codex", "codex"]
            ).map(\.id),
            ["mistral-cli", "codex"]
        )
        XCTAssertEqual(
            MenubarProviderFilters.visibleProviders(
                providers,
                requestedVisibleProviderIDs: ["codex", "foo-localhost-provider"],
                preferredOrder: ["mistral-cli", "codex"]
            ).map(\.id),
            ["codex"]
        )
        XCTAssertTrue(
            MenubarProviderFilters.visibleProviders(
                [providers[2]],
                requestedVisibleProviderIDs: ["foo-localhost-provider"],
                preferredOrder: ["foo-localhost-provider"]
            ).isEmpty
        )
    }

    private static let summaryJSON = """
    {
      "version": 1,
      "status": "healthy",
      "generatedAt": "2026-05-25T10:00:00Z",
      "stale": false,
      "today": {
        "activeSeconds": 2520,
        "waitSeconds": 120,
        "tokens": 18200,
        "costUSD": 0.31,
        "sessions": 3,
        "projects": 2
      },
      "currentSession": {
        "isActive": false,
        "source": "claude",
        "provider": "anthropic",
        "model": "Sonnet",
        "projectLabel": "Clipulse",
        "startedAt": "2026-05-25T09:30:00Z",
        "activeSeconds": 420,
        "tokens": 1800,
        "costUSD": 0.04
      },
      "activeBlock": {
        "isActive": false,
        "tokens": 0,
        "limit": null,
        "usagePercent": null,
        "burnRateTokensPerMinute": null,
        "projectedTokens": null,
        "resetAt": null,
        "remainingSeconds": null
      },
      "topRisk": {
        "providerId": null,
        "label": null,
        "status": "unknown",
        "usagePercent": null,
        "resetAt": null,
        "remainingSeconds": null
      },
      "providers": [
        {
          "id": "codex",
          "label": "Codex",
          "status": "unknown",
          "usagePercent": null,
          "tokensToday": 12400,
          "costTodayUSD": 0.22,
          "resetAt": null,
          "sparkline": [0, 1, 2]
        }
      ],
      "spool": {
        "pending": 0,
        "failed": 0
      },
      "alerts": [
        {
          "level": "warning",
          "message": "quota warning"
        }
      ]
    }
    """
}
