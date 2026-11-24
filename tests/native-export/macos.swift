// Exercise an existing packaged host in the runner's actual login session.
// These APIs never request Accessibility, Automation or Screen Recording access.
import Cocoa
import ApplicationServices
import CryptoKit
import ImageIO

struct Failure: Error, CustomStringConvertible {
    let description: String
    init(_ message: String) { description = message }
}
let appPath = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let fm = FileManager.default
try fm.createDirectory(at: output, withIntermediateDirectories: true)
var stage = "desktop"
var records: [[String: Any]] = []
var host: Process?
var appAX: AXUIElement?
var launcher: [String: Any] = [:]
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
func elements(_ root: AXUIElement) -> [(AXUIElement, Int)] {
    var queue: [(AXUIElement, Int)] = [(root, 0)]
    var offset = 0
    while offset < queue.count && offset < 2000 {
        let (element, depth) = queue[offset]
        offset += 1
        if depth < 30, let children = attribute(element, "AXChildren").1 as? [AXUIElement] {
            queue.append(contentsOf: children.map { ($0, depth + 1) })
        }
    }
    return Array(queue.prefix(2000))
}
func snapshot(_ root: AXUIElement) -> [[String: Any]] {
    return elements(root).map { element, depth in
        var actions: CFArray?
        let actionError = AXUIElementCopyActionNames(element, &actions)
        return ["depth": depth, "role": text(element, "AXRole"),
                "title": text(element, "AXTitle"), "description": text(element, "AXDescription"),
                "value": text(element, "AXValue"), "identifier": text(element, "AXIdentifier"),
                "actions": actions as? [String] ?? [], "actionError": actionError.rawValue]
    }
}
func capture(_ name: String) {
    if let root = appAX { try? write("\(name)-tree.json", snapshot(root)) }
    if CGPreflightScreenCaptureAccess() {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        task.arguments = ["-x", output.appendingPathComponent("\(name).png").path]
        do { try task.run(); task.waitUntilExit() }
        catch { try? write("\(name)-screenshot-error.json", ["error": String(describing: error)]) }
    }
}
func find(_ name: String, root: AXUIElement? = nil, role: String? = nil) -> AXUIElement? {
    guard let base = root ?? appAX else { return nil }
    return elements(base).first { element, _ in
        (role == nil || text(element, "AXRole") == role!) &&
        ["AXTitle", "AXDescription", "AXValue"].contains { text(element, $0) == name }
    }?.0
}
func wait<T>(_ description: String, seconds: Double = 30, _ test: () -> T?) throws -> T {
    let end = Date().addingTimeInterval(seconds)
    while Date() < end {
        if let result = test() { return result }
        if let app = host, !app.isRunning { throw Failure("Packaged host exited: \(app.terminationStatus)") }
        Thread.sleep(forTimeInterval: 0.2)
    }
    throw Failure("Timed out: \(description)")
}
func click(_ element: AXUIElement) throws {
    let error = AXUIElementPerformAction(element, kAXPressAction as CFString)
    // AXPress on a control which opens a modal dialog can time out after the
    // action succeeded; the next wait checks the actual native UI postcondition.
    if error == .success || error == .cannotComplete { return }
    guard CGPreflightPostEventAccess(),
          let pos = attribute(element, "AXPosition").1,
          let size = attribute(element, "AXSize").1,
          CFGetTypeID(pos) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID()
    else { throw Failure("AXPress failed: \(error.rawValue); no accessible bounds/input") }
    var point = CGPoint.zero
    var dimensions = CGSize.zero
    guard AXValueGetValue(pos as! AXValue, .cgPoint, &point),
          AXValueGetValue(size as! AXValue, .cgSize, &dimensions),
          dimensions.width > 0, dimensions.height > 0 else { throw Failure("Invalid native control bounds") }
    point.x += dimensions.width / 2; point.y += dimensions.height / 2
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
}
func clickName(_ name: String, root: AXUIElement? = nil) throws {
    let element = try wait("control \(name)") { find(name, root: root) }
    try click(element)
}
func key(_ code: CGKeyCode, flags: CGEventFlags = []) throws {
    guard CGPreflightPostEventAccess() else { throw Failure("BLOCKED: native key input is not authorized") }
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
    else { throw Failure("Could not create native key event") }
    down.flags = flags; up.flags = flags
    down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
}
func setValue(_ element: AXUIElement, _ value: String) throws {
    let error = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFString)
    guard error == .success else { throw Failure("AXValue set failed: \(error.rawValue)") }
    guard text(element, "AXValue") == value else { throw Failure("Native text field readback differs") }
}
func hash(_ path: URL) -> String? {
    guard let data = try? Data(contentsOf: path) else { return nil }
    return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}
func png(_ path: URL) throws -> [String: Any] {
    let data = try Data(contentsOf: path)
    guard Array(data.prefix(8)) == [137,80,78,71,13,10,26,10],
          let source = CGImageSourceCreateWithData(data as CFData, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil), image.width >= 100, image.height >= 100
    else { throw Failure("Invalid or unexpectedly small PNG") }
    var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
    try bytes.withUnsafeMutableBytes { buffer in
        guard let context = CGContext(data: buffer.baseAddress, width: image.width, height: image.height,
            bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw Failure("Could not decode PNG pixels") }
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    }
    var colors = Set<UInt32>()
    let step = max(1, max(image.width, image.height) / 500)
    for y in stride(from: 0, to: image.height, by: step) {
        for x in stride(from: 0, to: image.width, by: step) {
            let i = (y * image.width + x) * 4
            colors.insert(UInt32(bytes[i]) << 24 | UInt32(bytes[i+1]) << 16 | UInt32(bytes[i+2]) << 8 | UInt32(bytes[i+3]))
        }
    }
    guard colors.count >= 100 else { throw Failure("PNG lacks rendered scene colors: \(colors.count)") }
    return ["width": image.width, "height": image.height, "colors": colors.count,
            "bytes": data.count, "sha256": hash(path)!]
}
func launch(_ executable: URL, arguments: [String], logName: String, environment: [String: String]) throws -> Process {
    let log = output.appendingPathComponent(logName)
    _ = fm.createFile(atPath: log.path, contents: nil)
    let handle = try FileHandle(forWritingTo: log)
    let app = Process()
    app.executableURL = executable; app.arguments = arguments; app.environment = environment
    app.standardInput = FileHandle.nullDevice; app.standardOutput = handle; app.standardError = handle
    try app.run()
    try handle.close()
    return app
}

let environment = ProcessInfo.processInfo.environment
var info: [String: Any] = [
    "platform": "macOS", "os": ProcessInfo.processInfo.operatingSystemVersionString,
    "runnerImage": environment["ImageOS"] ?? "", "runnerVersion": environment["ImageVersion"] ?? "",
    "uid": getuid(), "session": CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:],
    "accessibilityTrusted": AXIsProcessTrusted(), "screenCaptureAllowed": CGPreflightScreenCaptureAccess(),
    "postEventAllowed": CGPreflightPostEventAccess(),
    "screens": NSScreen.screens.map { ["width": $0.frame.width, "height": $0.frame.height] }, "app": appPath.path,
]
try write("environment.json", info)
do {
    guard AXIsProcessTrusted() else { throw Failure("BLOCKED: existing Accessibility authorization is absent") }
    let session = output.appendingPathComponent("session")
    try fm.createDirectory(at: session, withIntermediateDirectories: true)
    let fixture = session.appendingPathComponent("water.xyz")
    try "3\nwater\nO 0 0 0\nH 0 0 0.96\nH 0.92 0 -0.24\n".write(to: fixture, atomically: true, encoding: .utf8)
    let manifest = session.appendingPathComponent("manifest.json")
    try #"{"structure":{"path":"water.xyz","format":"xyz"},"cubes":[]}"#.write(to: manifest, atomically: true, encoding: .utf8)
    stage = "app-launcher"
    var appEnvironment = environment
    appEnvironment["MULTIWFN_DIRECT_GUI"] = "1"
    let wrapper = try launch(appPath.appendingPathComponent("Contents/MacOS/Multiwfn"),
        arguments: [fixture.path], logName: "app-launcher.log", environment: appEnvironment)
    let wrapperEnd = Date().addingTimeInterval(10)
    while wrapper.isRunning && Date() < wrapperEnd { Thread.sleep(forTimeInterval: 0.2) }
    launcher = ["runningAfter10Seconds": wrapper.isRunning, "log": "app-launcher.log"]
    if wrapper.isRunning { wrapper.terminate(); wrapper.waitUntilExit() }
    else { launcher["exitCode"] = wrapper.terminationStatus }
    launcher["logText"] = (try? String(contentsOf: output.appendingPathComponent("app-launcher.log"), encoding: .utf8)) ?? ""
    try write("app-launcher.json", launcher)
    // Independently validate the unmodified host from this same app. A launcher
    // failure remains a separate product failure, even if all host saves pass.
    stage = "packaged-host-launch"
    let resources = appPath.appendingPathComponent("Contents/Resources")
    host = try launch(resources.appendingPathComponent("tools/matterviz-desktop"), arguments: [
        "--frontend", resources.appendingPathComponent("frontend/matterviz-viewer/dist").path,
        "--session", session.path, "--manifest", manifest.path, "--port", "0", "--startup-timeout", "120"
    ], logName: "host.log", environment: environment)
    appAX = AXUIElementCreateApplication(host!.processIdentifier)
    AXUIElementSetMessagingTimeout(appAX!, 5)
    NSRunningApplication(processIdentifier: host!.processIdentifier)?.activate(options: [.activateIgnoringOtherApps])
    info["hostPID"] = host!.processIdentifier
    try write("environment.json", info)
    stage = "webview-accessibility"
    _ = try wait("loaded structure in WKWebView", seconds: 90) { find("Structure loaded") }
    capture("startup")
    let target = output.appendingPathComponent("export.png")
    for mode in ["cancel", "save", "refuse-overwrite", "overwrite"] {
        var before = hash(target)
        if mode == "overwrite" {
            try Data("MWFN overwrite sentinel\n".utf8).write(to: target)
            try fm.copyItem(at: target, to: output.appendingPathComponent("before-overwrite.bin"))
            before = hash(target)
        }
        stage = "\(mode)-render"
        try clickName("Save")
        try clickName("PNG image")
        stage = "\(mode)-chooser"
        let cancel = try wait("native Save panel Cancel button", seconds: 45) { find("Cancel", role: "AXButton") }
        capture("\(mode)-dialog")
        if mode == "cancel" { try click(cancel) }
        else {
            // Standard NSSavePanel Go to Folder interaction; use existing input
            // access only and assert the field value before submitting it.
            try key(5, flags: [.maskCommand, .maskShift]) // G
            let folderField = try wait("Go to Folder path field") {
                guard let value = attribute(appAX!, "AXFocusedUIElement").1,
                      CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil as AXUIElement? }
                let element = value as! AXUIElement
                let role = text(element, "AXRole")
                return (role == "AXComboBox" || role == "AXTextField") &&
                    text(element, "AXIdentifier") != "saveAsNameTextField" &&
                    text(element, "AXDescription") != "Save As:" ? element : nil
            }
            try setValue(folderField, output.path)
            capture("\(mode)-folder")
            try key(36) // Return
            let filename = try wait("native Save As filename field") {
                elements(appAX!).first { element, _ in
                    text(element, "AXRole") == "AXTextField" &&
                    (text(element, "AXIdentifier") == "saveAsNameTextField" ||
                     text(element, "AXDescription") == "Save As:")
                }?.0
            }
            try setValue(filename, target.lastPathComponent)
            capture("\(mode)-filename")
            try clickName("Save")
            if mode == "refuse-overwrite" || mode == "overwrite" {
                let replace = try wait("native replacement confirmation") { find("Replace", role: "AXButton") }
                capture("\(mode)-confirmation")
                if mode == "refuse-overwrite" {
                    try clickName("Cancel")
                    _ = try wait("dismiss replacement confirmation") { find("Replace", role: "AXButton") == nil ? true : nil }
                    try clickName("Cancel")
                } else { try click(replace) }
            }
        }
        stage = "\(mode)-file"
        var image: [String: Any] = [:]
        if mode == "cancel" || mode == "refuse-overwrite" {
            _ = try wait("cancelled status") { find("Save cancelled") }
            guard hash(target) == before else { throw Failure("Cancellation changed target file") }
        } else {
            _ = try wait("completed native write") { find("PNG exported") }
            image = try png(target)
            if mode == "overwrite" && hash(target) == before { throw Failure("Confirmed overwrite retained sentinel") }
            try fm.copyItem(at: target, to: output.appendingPathComponent("\(mode).png"))
        }
        capture("\(mode)-result")
        records.append(["case": mode, "before": before as Any? ?? NSNull(), "after": hash(target) as Any? ?? NSNull(),
                        "png": image, "passed": true])
        try write("results.json", ["status": "in_progress", "stage": stage, "cases": records, "launcher": launcher])
    }
    try write("results.json", ["status": "passed", "stage": "complete", "cases": records, "launcher": launcher,
        "scope": "Unmodified packaged host with managed fixture; app entry is reported independently in launcher."])
    if let app = host, app.isRunning { app.terminate() }
} catch {
    capture("failure")
    let reason = String(describing: error)
    try write("results.json", ["status": reason.hasPrefix("BLOCKED:") ? "blocked" : "failed",
        "stage": stage, "error": reason, "cases": records, "launcher": launcher])
    if let app = host, app.isRunning { app.terminate() }
    print(reason)
    exit(2)
}
