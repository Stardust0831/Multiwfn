// Exercise the packaged macOS user entry and native saves in its login session.
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
var ownedProcess: Process?
var nativeHost: NSRunningApplication?
var appAX: AXUIElement?
var entries: [[String: Any]] = []
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
        if let app = nativeHost, app.isTerminated { throw Failure("Packaged host exited before the expected UI state") }
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
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
    let element = try wait("control \(name)") {
        elements(root ?? appAX!).first { element, _ in
            ["AXButton", "AXPopUpButton", "AXMenuItem"].contains(text(element, "AXRole")) &&
            ["AXTitle", "AXDescription", "AXValue"].contains { text(element, $0) == name }
        }?.0
    }
    try click(element)
}
func container(_ element: AXUIElement) throws -> AXUIElement {
    var current = element
    for _ in 0..<20 {
        guard let parent = attribute(current, "AXParent").1,
              CFGetTypeID(parent) == AXUIElementGetTypeID() else { break }
        current = parent as! AXUIElement
        if ["AXSheet", "AXWindow"].contains(text(current, "AXRole")) { return current }
    }
    throw Failure("Native dialog container is missing")
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

func activeApp(_ executable: URL) -> NSRunningApplication? {
    let expected = executable.resolvingSymlinksInPath().path
    return NSWorkspace.shared.runningApplications.first {
        !$0.isTerminated && $0.executableURL?.resolvingSymlinksInPath().path == expected
    }
}
func inspectApp(_ app: NSRunningApplication) {
    appAX = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(appAX!, 5)
    app.activate(options: [])
}
func logText(_ name: String) -> String {
    return (try? String(contentsOf: output.appendingPathComponent(name), encoding: .utf8)) ?? ""
}
func appLogs(_ name: String) -> String {
    return logText("\(name).stdout.log") + "\n" + logText("\(name).stderr.log")
}
func openApplication(_ name: String, document: URL? = nil) throws -> Process {
    for stream in ["stdout", "stderr"] {
        _ = fm.createFile(atPath: output.appendingPathComponent("\(name).\(stream).log").path, contents: nil)
    }
    var args = ["-n", "-W", "--stdout", output.appendingPathComponent("\(name).stdout.log").path,
                "--stderr", output.appendingPathComponent("\(name).stderr.log").path,
                "--env", "OMP_THREAD_LIMIT=1", "--env", "GFORTRAN_UNBUFFERED_ALL=y",
                "--env", "MULTIWFN_MATTERVIZ_PORT=0", "-a", appPath.path]
    if let document = document { args.append(document.path) }
    // LaunchServices delivers document events just as Finder/Open With does.
    // Only explicitly listed application environment variables are passed.
    return try launch(URL(fileURLWithPath: "/usr/bin/open"), arguments: args,
                      logName: "\(name)-open.log", environment: environment)
}
func exitStatus(_ app: Process, name: String) throws -> Int32 {
    _ = try wait("\(name) process exit", seconds: 30) { !app.isRunning ? true : nil }
    app.waitUntilExit()
    guard app.terminationStatus == 0 else { throw Failure("\(name) exited \(app.terminationStatus)") }
    return app.terminationStatus
}
func chooseInput(_ fixture: URL) throws {
    let panel = try wait("native Open panel") { find("Multiwfn - Select Input File", role: "AXWindow") }
    capture("no-argument-open-panel")
    try key(5, flags: [.maskCommand, .maskShift])
    let path = try wait("Open panel Go to Folder path") {
        elements(panel).first { text($0.0, "AXIdentifier") == "PathTextField" }?.0
    }
    try setValue(path, fixture.path)
    capture("no-argument-selected-path")
    try key(36)
    _ = try wait("Open panel Go to Folder dismissed") {
        elements(panel).contains { text($0.0, "AXIdentifier") == "GoToWindow" } ? nil : true
    }
    try clickName("Open", root: panel)
}
func awaitViewer() throws {
    let executable = appPath.appendingPathComponent("Contents/Resources/tools/matterviz-desktop")
    nativeHost = try wait("host started by the app entry", seconds: 120) { activeApp(executable) }
    inspectApp(nativeHost!)
    _ = try wait("loaded structure in WKWebView", seconds: 90) { find("Structure loaded") }
}
func readSession(_ name: String, log: String, path: String) throws -> [String: Any] {
    let line = try wait("host URL in app output") {
        appLogs(log).components(separatedBy: .newlines).first { $0.hasPrefix("Multiwfn MatterViz GUI service: http://") }
    }
    let urlString = String(line.dropFirst("Multiwfn MatterViz GUI service: ".count))
    guard var url = URLComponents(string: urlString) else { throw Failure("Invalid host URL") }
    url.path = path
    url.queryItems = url.queryItems?.filter { $0.name == "cap" }
    let destination = output.appendingPathComponent(name)
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
    task.arguments = ["--fail", "--silent", "--show-error", "--max-time", "10", "--noproxy", "*",
                      "--output", destination.path, url.url!.absoluteString]
    try task.run(); task.waitUntilExit()
    guard task.terminationStatus == 0 else { throw Failure("Reading actual session failed: \(path)") }
    return try JSONSerialization.jsonObject(with: Data(contentsOf: destination)) as! [String: Any]
}
func verifyInput(_ name: String, fixture: URL, atoms: [(String, [Double])]) throws {
    _ = try wait("requested input loaded by the real core") {
        appLogs(name).contains("Loaded \(fixture.path) successfully!") ? true : nil
    }
    let manifest = try readSession("\(name)-manifest.json", log: name, path: "/session/manifest.json")
    guard (manifest["multiwfnGui"] as? [String: Any])?["entry"] as? String == "drawmolgui" else {
        throw Failure("The app did not start the core's molecular viewer")
    }
    let structure = try readSession("\(name)-structure.json", log: name, path: "/session/structure.json")
    guard let sites = structure["sites"] as? [[String: Any]], sites.count == atoms.count else {
        throw Failure("Loaded atom count differs from the requested input")
    }
    for (site, expected) in zip(sites, atoms) {
        guard let species = site["species"] as? [[String: Any]], species.first?["element"] as? String == expected.0,
              let xyz = site["xyz"] as? [Double], xyz.count == 3,
              zip(xyz, expected.1).allSatisfy({ observed, wanted in abs(observed - wanted) < 1e-7 }) else {
            throw Failure("Loaded species/coordinates differ from requested input")
        }
    }
    capture("\(name)-loaded")
    entries.append(["case": name, "input": fixture.path, "inputSha256": hash(fixture)!,
                    "atoms": atoms.count, "speciesAndCoordinatesMatch": true,
                    "hostPID": nativeHost!.processIdentifier, "passed": true])
}
func returnFromViewer(_ name: String, launcher: Process) throws {
    let app = nativeHost!
    try clickName("Return")
    nativeHost = nil
    _ = try wait("host closed after Return", seconds: 30) { app.isTerminated ? true : nil }
    let status = try exitStatus(launcher, name: name)
    guard !appLogs(name).contains("Fortran runtime error") else { throw Failure("Core runtime error after Return") }
    entries[entries.count - 1]["launcherExit"] = status
    entries[entries.count - 1]["hostClosedAfterReturn"] = true
    appAX = nil
}
func checkCLI(_ name: String, fixture: URL, noArguments: Bool) throws {
    let task = Process()
    let log = output.appendingPathComponent("\(name).log")
    _ = fm.createFile(atPath: log.path, contents: nil)
    let handle = try FileHandle(forWritingTo: log)
    let input = Pipe()
    task.executableURL = appPath.appendingPathComponent("Contents/MacOS/Multiwfn")
    task.arguments = noArguments ? [] : [fixture.path, "-nt", "1"]
    var cliEnvironment = environment
    cliEnvironment["MULTIWFN_DIRECT_GUI"] = "0"
    cliEnvironment["GFORTRAN_UNBUFFERED_ALL"] = "y"
    task.environment = cliEnvironment
    task.standardInput = input; task.standardOutput = handle; task.standardError = handle
    ownedProcess = task
    try task.run(); try handle.close()
    try input.fileHandleForWriting.write(contentsOf: Data((noArguments ? "\(fixture.path)\nq\n" : "q\n").utf8))
    try input.fileHandleForWriting.close()
    let status = try exitStatus(task, name: name)
    guard logText("\(name).log").contains("Loaded \(fixture.path) successfully!") else {
        throw Failure("CLI did not load the requested input")
    }
    entries.append(["case": name, "input": fixture.path, "exitCode": status, "passed": true])
}
func exerciseExports() throws {
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
        let panel = try container(cancel)
        capture("\(mode)-dialog")
        if mode == "cancel" { try click(cancel) }
        else {
            // Standard NSSavePanel Go to Folder interaction; use existing input
            // access only and assert the field value before submitting it.
            try key(5, flags: [.maskCommand, .maskShift]) // G
            let folderField = try wait("Go to Folder path field") {
                elements(panel).first { text($0.0, "AXIdentifier") == "PathTextField" }?.0
            }
            try setValue(folderField, output.path)
            capture("\(mode)-folder")
            try key(36) // Return
            _ = try wait("Go to Folder sheet dismissed") {
                elements(panel).contains { text($0.0, "AXIdentifier") == "GoToWindow" } ? nil : true
            }
            let filename = try wait("native Save As filename field") {
                elements(appAX!).first { element, _ in
                    text(element, "AXRole") == "AXTextField" &&
                    (text(element, "AXIdentifier") == "saveAsNameTextField" ||
                     text(element, "AXDescription") == "Save As:")
                }?.0
            }
            try setValue(filename, target.lastPathComponent)
            capture("\(mode)-filename")
            try clickName("Save", root: panel)
            if mode == "refuse-overwrite" || mode == "overwrite" {
                let replace = try wait("native replacement confirmation") { find("Replace", role: "AXButton") }
                capture("\(mode)-confirmation")
                if mode == "refuse-overwrite" {
                    try clickName("Cancel", root: container(replace))
                    _ = try wait("dismiss replacement confirmation") { find("Replace", role: "AXButton") == nil ? true : nil }
                    try clickName("Cancel", root: panel)
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
        try write("results.json", ["status": "in_progress", "stage": stage, "cases": records, "entries": entries])
    }
}

do {
    guard AXIsProcessTrusted() else { throw Failure("BLOCKED: existing Accessibility authorization is absent") }
    let inputs = output.appendingPathComponent("input files")
    try fm.createDirectory(at: inputs, withIntermediateDirectories: true)
    let water = inputs.appendingPathComponent("选择 水 molecule.xyz")
    let methane = inputs.appendingPathComponent("打开 甲烷 molecule.xyz")
    try "3\nwater\nO 0 0 0\nH 0 0 0.96\nH 0.92 0 -0.24\n".write(to: water, atomically: true, encoding: .utf8)
    try "5\nmethane\nC 0 0 0\nH 0.63 0.63 0.63\nH -0.63 -0.63 0.63\nH -0.63 0.63 -0.63\nH 0.63 -0.63 -0.63\n".write(to: methane, atomically: true, encoding: .utf8)
    let waterAtoms: [(String, [Double])] = [("O", [0,0,0]), ("H", [0,0,0.96]), ("H", [0.92,0,-0.24])]
    let methaneAtoms: [(String, [Double])] = [("C", [0,0,0]), ("H", [0.63,0.63,0.63]),
        ("H", [-0.63,-0.63,0.63]), ("H", [-0.63,0.63,-0.63]), ("H", [0.63,-0.63,-0.63])]

    stage = "no-argument-app-entry"
    ownedProcess = try openApplication("no-argument")
    let cocoa = try wait("Cocoa user entry", seconds: 30) {
        activeApp(appPath.appendingPathComponent("Contents/MacOS/Multiwfn"))
    }
    inspectApp(cocoa)
    try chooseInput(water)
    try awaitViewer()
    try verifyInput("no-argument", fixture: water, atoms: waterAtoms)
    try returnFromViewer("no-argument", launcher: ownedProcess!)

    stage = "document-open-app-entry"
    ownedProcess = try openApplication("document-open", document: methane)
    try awaitViewer()
    try verifyInput("document-open", fixture: methane, atoms: methaneAtoms)
    try exerciseExports()
    try returnFromViewer("document-open", launcher: ownedProcess!)

    // Exercise the documented direct GUI and terminal routes against the real
    // core as well: its exit status must be 0 after consuming the queued q.
    stage = "direct-gui-process-exit"
    var directEnvironment = environment
    directEnvironment["MULTIWFN_DIRECT_GUI"] = "1"
    directEnvironment["GFORTRAN_UNBUFFERED_ALL"] = "y"
    directEnvironment["MULTIWFN_MATTERVIZ_PORT"] = "0"
    ownedProcess = try launch(appPath.appendingPathComponent("Contents/MacOS/Multiwfn"),
        arguments: [water.path], logName: "direct-gui.stdout.log", environment: directEnvironment)
    try awaitViewer()
    try verifyInput("direct-gui", fixture: water, atoms: waterAtoms)
    try returnFromViewer("direct-gui", launcher: ownedProcess!)
    stage = "cli-compatibility"
    try checkCLI("cli-file", fixture: water, noArguments: false)
    try checkCLI("cli-no-arguments", fixture: methane, noArguments: true)
    try write("results.json", ["status": "passed", "stage": "complete", "entries": entries, "cases": records,
        "scope": "Real packaged Cocoa/LaunchServices entry, core-loaded input and native WebView exports; no managed fixture fallback."])
} catch {
    capture("failure")
    let reason = String(describing: error)
    try write("results.json", ["status": reason.hasPrefix("BLOCKED:") ? "blocked" : "failed",
        "stage": stage, "error": reason, "cases": records, "entries": entries])
    nativeHost?.terminate()
    if let app = ownedProcess, app.isRunning { app.terminate() }
    print(reason)
    exit(2)
}
