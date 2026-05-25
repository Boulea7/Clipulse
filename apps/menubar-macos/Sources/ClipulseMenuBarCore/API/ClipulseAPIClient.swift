import Foundation

public protocol HTTPClient {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: HTTPClient {}

public struct ClipulseMenuBarConfiguration: Equatable {
    public var apiBaseURL: URL
    public var dashboardURL: URL
    public var bearerToken: String?
    public var allowRemoteAPI: Bool

    public init(apiBaseURL: URL, dashboardURL: URL, bearerToken: String?, allowRemoteAPI: Bool = false) {
        self.apiBaseURL = apiBaseURL
        self.dashboardURL = dashboardURL
        self.bearerToken = bearerToken
        self.allowRemoteAPI = allowRemoteAPI
    }

    public static func fromEnvironment(_ environment: [String: String] = ProcessInfo.processInfo.environment) -> ClipulseMenuBarConfiguration {
        let apiURLValue = environment["CLIPULSE_MENUBAR_API_URL"]
            ?? environment["CLIPULSE_API_URL"]
            ?? "http://127.0.0.1:8000"
        let dashboardURLValue = environment["CLIPULSE_DASHBOARD_URL"] ?? apiURLValue
        let apiURL = URL(string: apiURLValue) ?? URL(string: "http://127.0.0.1:8000")!
        let dashboardURL = URL(string: dashboardURLValue) ?? apiURL
        let token = environment["CLIPULSE_MENUBAR_TOKEN"] ?? environment["CLIPULSE_API_BEARER_TOKEN"]
        let allowRemoteAPI = isTruthyEnvironmentValue(environment["CLIPULSE_MENUBAR_ALLOW_REMOTE_API"])
        return ClipulseMenuBarConfiguration(
            apiBaseURL: apiURL,
            dashboardURL: dashboardURL,
            bearerToken: token,
            allowRemoteAPI: allowRemoteAPI
        )
    }
}

public struct ClipulseAPIClient {
    private let configuration: ClipulseMenuBarConfiguration
    private let httpClient: HTTPClient
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(
        configuration: ClipulseMenuBarConfiguration = .fromEnvironment(),
        httpClient: HTTPClient = URLSession.shared
    ) {
        self.configuration = configuration
        self.httpClient = httpClient
        decoder = JSONDecoder()
        encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
    }

    public var dashboardURL: URL {
        configuration.dashboardURL
    }

    public func fetchSummary() async throws -> MenubarSummary {
        try await request("api/v1/menubar/summary", method: "GET", responseType: MenubarSummary.self)
    }

    public func fetchPreferences() async throws -> MenubarPreferences {
        try await request("api/v1/menubar/preferences", method: "GET", responseType: MenubarPreferences.self)
    }

    public func updatePreferences(_ preferences: MenubarPreferences) async throws -> MenubarPreferences {
        try await request(
            "api/v1/menubar/preferences",
            method: "PUT",
            body: preferences,
            responseType: MenubarPreferences.self
        )
    }

    public func refreshSummary() async throws -> MenubarSummary {
        try await request("api/v1/menubar/refresh", method: "POST", responseType: MenubarSummary.self)
    }

    private func request<Response: Decodable>(
        _ path: String,
        method: String,
        body: Encodable? = nil,
        responseType: Response.Type
    ) async throws -> Response {
        guard configuration.allowRemoteAPI || configuration.apiBaseURL.isLoopbackHTTPURL else {
            throw ClipulseAPIError.nonLoopbackAPIURL(configuration.apiBaseURL.host ?? configuration.apiBaseURL.absoluteString)
        }

        var request = URLRequest(url: configuration.apiBaseURL.appending(path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bearerToken = configuration.bearerToken, !bearerToken.isEmpty {
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpBody = try encoder.encode(AnyEncodable(body))
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await httpClient.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ClipulseAPIError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw ClipulseAPIError.httpStatus(httpResponse.statusCode)
        }
        return try decoder.decode(Response.self, from: data)
    }
}

public enum ClipulseAPIError: Error, LocalizedError, Equatable {
    case invalidResponse
    case httpStatus(Int)
    case nonLoopbackAPIURL(String)

    public var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Clipulse returned a non-HTTP response."
        case .httpStatus(let status):
            return "Clipulse returned HTTP \(status)."
        case .nonLoopbackAPIURL(let host):
            return "Clipulse menu bar only sends tokens to loopback API URLs by default. Refused host: \(host)."
        }
    }
}

private func isTruthyEnvironmentValue(_ value: String?) -> Bool {
    switch value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "1", "true", "yes", "on":
        return true
    default:
        return false
    }
}

private extension URL {
    var isLoopbackHTTPURL: Bool {
        guard let scheme = scheme?.lowercased(), ["http", "https"].contains(scheme) else {
            return false
        }
        guard let host = host?.lowercased() else {
            return false
        }
        return host == "localhost"
            || host == "::1"
            || host == "0:0:0:0:0:0:0:1"
            || isIPv4LoopbackHost(host)
    }
}

private func isIPv4LoopbackHost(_ host: String) -> Bool {
    let parts = host.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 4 else {
        return false
    }
    let octets = parts.compactMap { Int($0) }
    guard octets.count == 4, octets.allSatisfy({ (0...255).contains($0) }) else {
        return false
    }
    return octets[0] == 127
}

private struct AnyEncodable: Encodable {
    private let encodeValue: (Encoder) throws -> Void

    init(_ value: Encodable) {
        encodeValue = value.encode
    }

    func encode(to encoder: Encoder) throws {
        try encodeValue(encoder)
    }
}
