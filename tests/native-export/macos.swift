// Inspect an existing packaged app in the runner's actual login session.
// These APIs never request Accessibility, Automation or Screen Recording access.
import Cocoa
import ApplicationServices

let appPath = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let fm = FileManager.default
try fm.createDirectory(at: output, withIntermediateDirectories: true)
func write(_ name: String, _ value: Any) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: output.appendingPathComponent(name))
}
func attribute(_ element: AXUIElement, _ name: String) -> (AXError, CFTypeRef?) {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    return (error, value)
}
func text(_ element: AXUIElement, _ name: String) -> String {
    return attribute(element, name).1 as? String ?? ""
}
func snapshot(_ root: AXUIElement) -> [[String: Any]] {
    var queue: [(AXUIElement, Int)] = [(root, 0)]
    var result: [[String: Any]] = []
    var offset = 0
    while offset < queue.count && offset < 2000 {
        let (element, depth) = queue[offset]
        offset += 1
        result.append(["depth": depth, "role": text(element, "AXRole"),
                       "title": text(element, "AXTitle"), "description": text(element, "AXDescription"),
                       "value": text(element, "AXValue"), "identifier": text(element, "AXIdentifier")])
        if depth < 25, let children = attribute(element, "AXChildren").1 as? [AXUIElement] {
            queue.append(contentsOf: children.map { ($0, depth + 1) })
        }
    }
    return result
}

let environment = ProcessInfo.processInfo.environment
var info: [String: Any] = [
    "platform": "macOS", "os": ProcessInfo.processInfo.operatingSystemVersionString,
    "runnerImage": environment["ImageOS"] ?? "", "runnerVersion": environment["ImageVersion"] ?? "",
    "uid": getuid(), "session": CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:],
    "accessibilityTrusted": AXIsProcessTrusted(),
    "screenCaptureAllowed": CGPreflightScreenCaptureAccess(),
    "postEventAllowed": CGPreflightPostEventAccess(),
    "screens": NSScreen.screens.map { ["width": $0.frame.width, "height": $0.frame.height] },
    "app": appPath.path,
]
try write("environment.json", info)
let fixture = output.appendingPathComponent("water.xyz")
try "3\nwater\nO 0 0 0\nH 0 0 0.96\nH 0.92 0 -0.24\n".write(to: fixture, atomically: true, encoding: .utf8)
let log = output.appendingPathComponent("app.log")
fm.createFile(atPath: log.path, contents: nil)
let logHandle = try FileHandle(forWritingTo: log)
let app = Process()
app.executableURL = appPath.appendingPathComponent("Contents/MacOS/Multiwfn")
app.arguments = [fixture.path]
var appEnvironment = environment
appEnvironment["MULTIWFN_DIRECT_GUI"] = "1"
app.environment = appEnvironment
app.standardOutput = logHandle
app.standardError = logHandle
app.standardInput = FileHandle.nullDevice
try app.run()
defer { if app.isRunning { app.terminate() }; try? logHandle.close() }

let deadline = Date().addingTimeInterval(60)
var visibleWindows: [[String: Any]] = []
while Date() < deadline && app.isRunning {
    visibleWindows = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]] ?? []).filter { ($0[kCGWindowOwnerPID as String] as? Int) == Int(app.processIdentifier) }
    if !visibleWindows.isEmpty { break }
    Thread.sleep(forTimeInterval: 0.25)
}
info["appPID"] = app.processIdentifier
info["appRunning"] = app.isRunning
info["appWindows"] = visibleWindows
let appAX = AXUIElementCreateApplication(app.processIdentifier)
let windows = attribute(appAX, "AXWindows")
info["AXWindowsError"] = windows.0.rawValue
let systemAX = AXUIElementCreateSystemWide()
info["AXFocusedApplicationError"] = attribute(systemAX, "AXFocusedApplication").0.rawValue
try write("environment.json", info)
try write("accessibility-tree.json", snapshot(appAX))
if CGPreflightScreenCaptureAccess() {
    let capture = Process()
    capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    capture.arguments = ["-x", output.appendingPathComponent("desktop.png").path]
    try capture.run()
    capture.waitUntilExit()
    info["screenshotExit"] = capture.terminationStatus
    try write("environment.json", info)
}
let blocked = !AXIsProcessTrusted() || windows.0 == .apiDisabled
try write("results.json", [
    "status": blocked ? "blocked" : windows.0 == .success ? "automation_available" : "failed",
    "stage": "native-accessibility", "appRunning": app.isRunning,
    "AXWindowsError": windows.0.rawValue,
    "reason": blocked ? "Runner process lacks Accessibility authorization; no permission request or TCC change was attempted."
        : "Native accessibility probe completed; inspect the tree before choosing UI actions.",
    "rendering": "not established by window existence",
    "chooser": "not exercised", "diskWrite": "not exercised", "cases": [],
])
print(String(data: try Data(contentsOf: output.appendingPathComponent("results.json")), encoding: .utf8)!)
if app.isRunning { app.terminate() }
if blocked || windows.0 != .success { exit(2) }
