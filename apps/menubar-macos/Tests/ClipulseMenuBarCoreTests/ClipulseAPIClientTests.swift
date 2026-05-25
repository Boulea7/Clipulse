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
    func testRefreshAdjustmentKeepsPersistedPreferencesWhenUpdateFails() async throws {
        let preferencesJSON = """
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
