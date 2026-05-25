import Foundation
import XCTest
@testable import ClipulseMenuBarCore

final class ClipulseAPIClientTests: XCTestCase {
    func testSummaryRequestUsesLoopbackBaseURLAndBearerHeader() async throws {
        let http = MockHTTPClient(
            data: Data(MenubarSummaryTests.summaryJSONForClient.utf8),
            statusCode: 200
        )
        let client = ClipulseAPIClient(
            configuration: ClipulseMenuBarConfiguration(
                apiBaseURL: URL(string: "http://127.0.0.1:8000")!,
                dashboardURL: URL(string: "http://127.0.0.1:8000")!,
                bearerToken: "local-token"
            ),
            httpClient: http
        )

        _ = try await client.fetchSummary()

        XCTAssertEqual(http.lastRequest?.url?.absoluteString, "http://127.0.0.1:8000/api/v1/menubar/summary")
        XCTAssertEqual(http.lastRequest?.value(forHTTPHeaderField: "Authorization"), "Bearer local-token")
        XCTAssertEqual(http.requestCount, 1)
    }

    func testRejectsNonLoopbackAPIURLByDefaultBeforeSendingToken() async throws {
        let http = MockHTTPClient(
            data: Data(MenubarSummaryTests.summaryJSONForClient.utf8),
            statusCode: 200
        )
        let client = ClipulseAPIClient(
            configuration: ClipulseMenuBarConfiguration(
                apiBaseURL: URL(string: "https://example.com")!,
                dashboardURL: URL(string: "https://example.com")!,
                bearerToken: "must-not-leak"
            ),
            httpClient: http
        )

        do {
            _ = try await client.fetchSummary()
            XCTFail("Expected non-loopback API URL to be rejected")
        } catch let error as ClipulseAPIError {
            XCTAssertEqual(error, .nonLoopbackAPIURL("example.com"))
        }

        XCTAssertNil(http.lastRequest)
        XCTAssertEqual(http.requestCount, 0)
    }

    func testRejectsHostnameThatOnlyStartsWithLoopbackIPv4() async throws {
        let http = MockHTTPClient(
            data: Data(MenubarSummaryTests.summaryJSONForClient.utf8),
            statusCode: 200
        )
        let client = ClipulseAPIClient(
            configuration: ClipulseMenuBarConfiguration(
                apiBaseURL: URL(string: "https://127.0.0.1.evil.com")!,
                dashboardURL: URL(string: "https://127.0.0.1.evil.com")!,
                bearerToken: "must-not-leak"
            ),
            httpClient: http
        )

        do {
            _ = try await client.fetchSummary()
            XCTFail("Expected fake loopback hostname to be rejected")
        } catch let error as ClipulseAPIError {
            XCTAssertEqual(error, .nonLoopbackAPIURL("127.0.0.1.evil.com"))
        }

        XCTAssertNil(http.lastRequest)
        XCTAssertEqual(http.requestCount, 0)
    }

    func testAllowsRemoteAPIOnlyWithExplicitOptIn() async throws {
        let http = MockHTTPClient(
            data: Data(MenubarSummaryTests.summaryJSONForClient.utf8),
            statusCode: 200
        )
        let client = ClipulseAPIClient(
            configuration: ClipulseMenuBarConfiguration(
                apiBaseURL: URL(string: "https://example.com")!,
                dashboardURL: URL(string: "https://example.com")!,
                bearerToken: "explicit-token",
                allowRemoteAPI: true
            ),
            httpClient: http
        )

        _ = try await client.fetchSummary()

        XCTAssertEqual(http.lastRequest?.url?.absoluteString, "https://example.com/api/v1/menubar/summary")
        XCTAssertEqual(http.lastRequest?.value(forHTTPHeaderField: "Authorization"), "Bearer explicit-token")
    }

    func testConfigurationReadsRemoteOptInFromEnvironment() {
        let configuration = ClipulseMenuBarConfiguration.fromEnvironment([
            "CLIPULSE_MENUBAR_API_URL": "https://example.com",
            "CLIPULSE_MENUBAR_ALLOW_REMOTE_API": "true",
        ])

        XCTAssertEqual(configuration.apiBaseURL.absoluteString, "https://example.com")
        XCTAssertTrue(configuration.allowRemoteAPI)
    }

    @MainActor
    func testMenuBarAccessibilityLabelIncludesStatusAndStaleState() async throws {
        let staleSummaryJSON = MenubarSummaryTests.summaryJSONForClient
            .replacingOccurrences(of: #""status": "healthy""#, with: #""status": "offline""#)
            .replacingOccurrences(of: #""stale": false"#, with: #""stale": true"#)
        let http = RoutingHTTPClient([
            "GET /api/v1/menubar/preferences": (Data(preferencesJSON.utf8), 200),
            "GET /api/v1/menubar/summary": (Data(staleSummaryJSON.utf8), 200),
        ])
        let client = ClipulseAPIClient(
            configuration: ClipulseMenuBarConfiguration(
                apiBaseURL: URL(string: "http://127.0.0.1:8000")!,
                dashboardURL: URL(string: "http://127.0.0.1:8000")!,
                bearerToken: nil
            ),
            httpClient: http
        )
        let viewModel = MenuBarViewModel(client: client)

        await viewModel.loadInitial()

        XCTAssertEqual(viewModel.menuBarAccessibilityLabel, "Clipulse，状态：离线，数据可能已过期")
    }

    @MainActor
    func testMenuBarTitleTextFollowsStatusDisplayPreference() async throws {
        let preferences = preferencesJSON
            .replacingOccurrences(of: #""statusDisplay": "iconOnly""#, with: #""statusDisplay": "todayTokens""#)
        let summary = MenubarSummaryTests.summaryJSONForClient
            .replacingOccurrences(of: #""tokens": 0"#, with: #""tokens": 18200"#, options: [], range: MenubarSummaryTests.summaryJSONForClient.range(of: #""tokens": 0"#))
        let http = RoutingHTTPClient([
            "GET /api/v1/menubar/preferences": (Data(preferences.utf8), 200),
            "GET /api/v1/menubar/summary": (Data(summary.utf8), 200),
        ])
        let client = ClipulseAPIClient(
            configuration: ClipulseMenuBarConfiguration(
                apiBaseURL: URL(string: "http://127.0.0.1:8000")!,
                dashboardURL: URL(string: "http://127.0.0.1:8000")!,
                bearerToken: nil
            ),
            httpClient: http
        )
        let viewModel = MenuBarViewModel(client: client)

        await viewModel.loadInitial()

        XCTAssertEqual(viewModel.menuBarTitleText, "18.2k")
        XCTAssertEqual(viewModel.menuBarTitleAccessibilityText, "18.2k Token")
        XCTAssertEqual(viewModel.menuBarAccessibilityLabel, "Clipulse，状态：正常，显示：18.2k Token")
    }

    @MainActor
    func testMenuBarAlertCountUsesSemanticAccessibilityText() async throws {
        let preferences = preferencesJSON
            .replacingOccurrences(of: #""statusDisplay": "iconOnly""#, with: #""statusDisplay": "alertCount""#)
        let summary = MenubarSummaryTests.summaryJSONForClient
            .replacingOccurrences(
                of: #""alerts": []"#,
                with: #""alerts": [{"level": "warning", "message": "quota warning"}, {"level": "critical", "message": "quota critical"}]"#
            )
        let http = RoutingHTTPClient([
            "GET /api/v1/menubar/preferences": (Data(preferences.utf8), 200),
            "GET /api/v1/menubar/summary": (Data(summary.utf8), 200),
        ])
        let client = ClipulseAPIClient(
            configuration: ClipulseMenuBarConfiguration(
                apiBaseURL: URL(string: "http://127.0.0.1:8000")!,
                dashboardURL: URL(string: "http://127.0.0.1:8000")!,
                bearerToken: nil
            ),
            httpClient: http
        )
        let viewModel = MenuBarViewModel(client: client)

        await viewModel.loadInitial()

        XCTAssertEqual(viewModel.menuBarTitleText, "!2")
        XCTAssertEqual(viewModel.menuBarTitleAccessibilityText, "2 条提醒")
        XCTAssertEqual(viewModel.menuBarAccessibilityLabel, "Clipulse，状态：正常，显示：2 条提醒")
    }

    @MainActor
    func testMenuBarAlertCountTitleIsBounded() async throws {
        let preferences = preferencesJSON
            .replacingOccurrences(of: #""statusDisplay": "iconOnly""#, with: #""statusDisplay": "alertCount""#)
        let alerts = (0..<120)
            .map { #"{"level": "warning", "message": "quota warning \#($0)"}"# }
            .joined(separator: ", ")
        let summary = MenubarSummaryTests.summaryJSONForClient
            .replacingOccurrences(of: #""alerts": []"#, with: #""alerts": [\#(alerts)]"#)
        let http = RoutingHTTPClient([
            "GET /api/v1/menubar/preferences": (Data(preferences.utf8), 200),
            "GET /api/v1/menubar/summary": (Data(summary.utf8), 200),
        ])
        let client = ClipulseAPIClient(
            configuration: ClipulseMenuBarConfiguration(
                apiBaseURL: URL(string: "http://127.0.0.1:8000")!,
                dashboardURL: URL(string: "http://127.0.0.1:8000")!,
                bearerToken: nil
            ),
            httpClient: http
        )
        let viewModel = MenuBarViewModel(client: client)

        await viewModel.loadInitial()

        XCTAssertEqual(viewModel.menuBarTitleText, "!99+")
        XCTAssertEqual(viewModel.menuBarTitleAccessibilityText, "99 条以上提醒")
        XCTAssertEqual(viewModel.menuBarAccessibilityLabel, "Clipulse，状态：正常，显示：99 条以上提醒")
    }

    @MainActor
    func testMenuBarCostTitleIsBounded() async throws {
        let preferences = preferencesJSON
            .replacingOccurrences(of: #""statusDisplay": "iconOnly""#, with: #""statusDisplay": "todayCost""#)
        let summary = MenubarSummaryTests.summaryJSONForClient
            .replacingOccurrences(
                of: #""costUSD": 0"#,
                with: #""costUSD": 12345.67"#,
                options: [],
                range: MenubarSummaryTests.summaryJSONForClient.range(of: #""costUSD": 0"#)
            )
        let http = RoutingHTTPClient([
            "GET /api/v1/menubar/preferences": (Data(preferences.utf8), 200),
            "GET /api/v1/menubar/summary": (Data(summary.utf8), 200),
        ])
        let client = ClipulseAPIClient(
            configuration: ClipulseMenuBarConfiguration(
                apiBaseURL: URL(string: "http://127.0.0.1:8000")!,
                dashboardURL: URL(string: "http://127.0.0.1:8000")!,
                bearerToken: nil
            ),
            httpClient: http
        )
        let viewModel = MenuBarViewModel(client: client)

        await viewModel.loadInitial()

        XCTAssertEqual(viewModel.menuBarTitleText, "$999+")
        XCTAssertEqual(viewModel.menuBarTitleAccessibilityText, "$999+")
        XCTAssertEqual(viewModel.menuBarAccessibilityLabel, "Clipulse，状态：正常，显示：$999+")
    }

    @MainActor
    func testRefreshAdjustmentKeepsPersistedPreferencesWhenUpdateFails() async throws {
        let http = RoutingHTTPClient([
            "GET /api/v1/menubar/preferences": (Data(preferencesJSON.utf8), 200),
            "GET /api/v1/menubar/summary": (Data(MenubarSummaryTests.summaryJSONForClient.utf8), 200),
            "PUT /api/v1/menubar/preferences": (Data("{}".utf8), 500),
        ])
        let client = ClipulseAPIClient(
            configuration: ClipulseMenuBarConfiguration(
                apiBaseURL: URL(string: "http://127.0.0.1:8000")!,
                dashboardURL: URL(string: "http://127.0.0.1:8000")!,
                bearerToken: nil
            ),
            httpClient: http
        )
        let viewModel = MenuBarViewModel(client: client)

        await viewModel.loadInitial()
        await viewModel.adjustRefreshSeconds(by: 15)

        XCTAssertEqual(viewModel.preferences?.refreshSeconds, 60)
        XCTAssertEqual(viewModel.errorMessage, "Clipulse returned HTTP 500.")
    }

    @MainActor
    func testConcurrentPreferenceEditsPersistLatestChange() async throws {
        let http = BlockingPreferencesHTTPClient(
            preferencesJSON: preferencesJSON,
            summaryJSON: MenubarSummaryTests.summaryJSONForClient
        )
        let client = ClipulseAPIClient(
            configuration: ClipulseMenuBarConfiguration(
                apiBaseURL: URL(string: "http://127.0.0.1:8000")!,
                dashboardURL: URL(string: "http://127.0.0.1:8000")!,
                bearerToken: nil
            ),
            httpClient: http
        )
        let viewModel = MenuBarViewModel(client: client)

        await viewModel.loadInitial()
        let firstSave = Task { @MainActor in
            await viewModel.updateRefreshSeconds(120)
        }
        await http.waitForFirstPut()
        await viewModel.updateDefaultView("detailed")
        await http.releaseFirstPut()
        await firstSave.value

        let putBodies = await http.putBodies
        XCTAssertEqual(putBodies.count, 2)
        XCTAssertTrue(putBodies[0].contains(#""refreshSeconds":120"#))
        XCTAssertTrue(putBodies[0].contains(#""defaultView":"standard""#))
        XCTAssertTrue(putBodies[1].contains(#""refreshSeconds":120"#))
        XCTAssertTrue(putBodies[1].contains(#""defaultView":"detailed""#))
        XCTAssertEqual(viewModel.preferences?.refreshSeconds, 120)
        XCTAssertEqual(viewModel.preferences?.defaultView, "detailed")
    }

    private let preferencesJSON = """
    {
      "version": 2,
      "enabled": true,
      "refreshSeconds": 60,
      "defaultView": "standard",
      "statusDisplay": "iconOnly",
      "visibleMetrics": ["tokens"],
      "visibleProviders": ["codex"],
      "providerOrder": ["codex"],
      "thresholds": {"warningPercent": 70, "criticalPercent": 90},
      "theme": "system"
    }
    """
}

private final class MockHTTPClient: HTTPClient {
    private let data: Data
    private let response: HTTPURLResponse
    private(set) var lastRequest: URLRequest?
    private(set) var requestCount = 0

    init(data: Data, statusCode: Int) {
        self.data = data
        response = HTTPURLResponse(
            url: URL(string: "http://127.0.0.1:8000/api/v1/menubar/summary")!,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: nil
        )!
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        lastRequest = request
        requestCount += 1
        return (data, response)
    }
}

private final class RoutingHTTPClient: HTTPClient {
    private let responses: [String: (Data, Int)]

    init(_ responses: [String: (Data, Int)]) {
        self.responses = responses
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let key = "\(request.httpMethod ?? "GET") \(request.url?.path ?? "")"
        let response = responses[key] ?? (Data("{}".utf8), 404)
        return (
            response.0,
            HTTPURLResponse(
                url: request.url ?? URL(string: "http://127.0.0.1:8000")!,
                statusCode: response.1,
                httpVersion: nil,
                headerFields: nil
            )!
        )
    }
}

private final class BlockingPreferencesHTTPClient: HTTPClient {
    private let preferencesJSON: String
    private let summaryJSON: String
    private let state = BlockingPreferencesHTTPClientState()

    init(preferencesJSON: String, summaryJSON: String) {
        self.preferencesJSON = preferencesJSON
        self.summaryJSON = summaryJSON
    }

    var putBodies: [String] {
        get async {
            await state.putBodies
        }
    }

    func waitForFirstPut() async {
        await state.waitForFirstPut()
    }

    func releaseFirstPut() async {
        await state.releaseFirstPut()
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let method = request.httpMethod ?? "GET"
        let path = request.url?.path ?? ""
        let statusCode = 200
        let responseData: Data

        if method == "GET", path == "/api/v1/menubar/preferences" {
            responseData = Data(preferencesJSON.utf8)
        } else if method == "GET", path == "/api/v1/menubar/summary" {
            responseData = Data(summaryJSON.utf8)
        } else if method == "PUT", path == "/api/v1/menubar/preferences" {
            let body = String(data: request.httpBody ?? Data(), encoding: .utf8) ?? "{}"
            let putIndex = await state.recordPut(body)
            await state.waitForFirstPutReleaseIfNeeded(putIndex: putIndex)
            responseData = Data(body.utf8)
        } else {
            responseData = Data("{}".utf8)
        }

        return (
            responseData,
            HTTPURLResponse(
                url: request.url ?? URL(string: "http://127.0.0.1:8000")!,
                statusCode: statusCode,
                httpVersion: nil,
                headerFields: nil
            )!
        )
    }
}

private actor BlockingPreferencesHTTPClientState {
    private var storedPutBodies: [String] = []
    private var firstPutStarted = false
    private var firstPutReleased = false
    private var firstPutWaiters: [CheckedContinuation<Void, Never>] = []
    private var firstPutReleaseContinuation: CheckedContinuation<Void, Never>?

    var putBodies: [String] {
        storedPutBodies
    }

    func recordPut(_ body: String) -> Int {
        storedPutBodies.append(body)
        let putIndex = storedPutBodies.count
        if putIndex == 1 {
            firstPutStarted = true
            for waiter in firstPutWaiters {
                waiter.resume()
            }
            firstPutWaiters = []
        }
        return putIndex
    }

    func waitForFirstPut() async {
        if firstPutStarted {
            return
        }
        await withCheckedContinuation { continuation in
            firstPutWaiters.append(continuation)
        }
    }

    func waitForFirstPutReleaseIfNeeded(putIndex: Int) async {
        guard putIndex == 1, !firstPutReleased else {
            return
        }
        await withCheckedContinuation { continuation in
            firstPutReleaseContinuation = continuation
        }
    }

    func releaseFirstPut() {
        firstPutReleased = true
        firstPutReleaseContinuation?.resume()
        firstPutReleaseContinuation = nil
    }
}

extension MenubarSummaryTests {
    static let summaryJSONForClient = """
    {
      "version": 1,
      "status": "healthy",
      "generatedAt": "2026-05-25T10:00:00Z",
      "stale": false,
      "today": {
        "activeSeconds": 0,
        "waitSeconds": 0,
        "tokens": 0,
        "costUSD": 0,
        "sessions": 0,
        "projects": 0
      },
      "currentSession": {
        "isActive": false,
        "source": null,
        "provider": null,
        "model": null,
        "projectLabel": null,
        "startedAt": null,
        "activeSeconds": 0,
        "tokens": 0,
        "costUSD": 0
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
      "providers": [],
      "spool": {
        "pending": 0,
        "failed": 0
      },
      "alerts": []
    }
    """
}
