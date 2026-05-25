public enum MenubarProviderFilters {
    public static func safeProviders(_ providers: [MenubarProviderSummary]) -> [MenubarProviderSummary] {
        providers.filter { ClipulseFormatters.isSafeProviderID($0.id) }
    }

    public static func visibleProviders(
        _ providers: [MenubarProviderSummary],
        requestedVisibleProviderIDs: [String] = [],
        preferredOrder: [String] = [],
        limit: Int? = nil
    ) -> [MenubarProviderSummary] {
        let safeProviders = safeProviders(providers)
        let safeProviderIDs = Set(safeProviders.map(\.id))
        let requestedVisibleIDs = Set(
            requestedVisibleProviderIDs.filter { ClipulseFormatters.isSafeProviderID($0) }
        ).intersection(safeProviderIDs)
        let selectedProviders = requestedVisibleIDs.isEmpty
            ? safeProviders
            : safeProviders.filter { requestedVisibleIDs.contains($0.id) }
        let orderedProviders = ordered(selectedProviders, preferredOrder: preferredOrder)

        guard let limit else {
            return orderedProviders
        }
        return Array(orderedProviders.prefix(limit))
    }

    private static func ordered(
        _ providers: [MenubarProviderSummary],
        preferredOrder: [String]
    ) -> [MenubarProviderSummary] {
        guard !preferredOrder.isEmpty else {
            return providers
        }

        var positionByID: [String: Int] = [:]
        for (offset, providerID) in preferredOrder.enumerated()
            where ClipulseFormatters.isSafeProviderID(providerID) && positionByID[providerID] == nil {
            positionByID[providerID] = offset
        }

        return providers.sorted { lhs, rhs in
            let lhsPosition = positionByID[lhs.id] ?? Int.max
            let rhsPosition = positionByID[rhs.id] ?? Int.max
            if lhsPosition == rhsPosition {
                let lhsLabel = ClipulseFormatters.providerDisplayLabel(providerID: lhs.id)
                let rhsLabel = ClipulseFormatters.providerDisplayLabel(providerID: rhs.id)
                return lhsLabel.localizedCaseInsensitiveCompare(rhsLabel) == .orderedAscending
            }
            return lhsPosition < rhsPosition
        }
    }
}
