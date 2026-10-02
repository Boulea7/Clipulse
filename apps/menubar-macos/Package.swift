// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "ClipulseMenuBar",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "ClipulseMenuBar", targets: ["ClipulseMenuBar"]),
        .library(name: "ClipulseMenuBarCore", targets: ["ClipulseMenuBarCore"]),
    ],
    targets: [
        .target(name: "ClipulseMenuBarCore"),
        .executableTarget(
            name: "ClipulseMenuBar",
            dependencies: ["ClipulseMenuBarCore"]
        ),
        .testTarget(
            name: "ClipulseMenuBarCoreTests",
            dependencies: ["ClipulseMenuBarCore"]
        ),
    ]
)
