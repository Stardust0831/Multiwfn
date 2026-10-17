//! Opt-in extracted-package test through the real workflow-only HTTP service.
use matterviz_volume_e2e::service::WorkbenchService;
use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::{Duration, Instant};

fn request(page: &url::Url, action: &str, body: Option<Value>) -> Value {
    let cap = page.query_pairs().find(|(k, _)| k == "cap").unwrap().1;
    let method = if body.is_some() { "POST" } else { "GET" };
    let data = body.map(|v| v.to_string()).unwrap_or_default();
    let mut stream = TcpStream::connect(page.authority()).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(30)))
        .unwrap();
    write!(stream, "{method} /api/workflows/{action}?cap={cap} HTTP/1.1\r\nHost: {}\r\nOrigin: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{data}", page.authority(), page.origin().ascii_serialization(), data.len()).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    serde_json::from_str(response.split_once("\r\n\r\n").unwrap().1).unwrap()
}

#[test]
#[ignore = "requires a packaged runner/engine/frontend; optional benzene Mayer calculation"]
fn independent_workbench_runs_without_session() {
    let root =
        PathBuf::from(std::env::var_os("BANEWFN_TEST_PACKAGE").expect("BANEWFN_TEST_PACKAGE"));
    let check =
        PathBuf::from(std::env::var_os("BANEWFN_TEST_OUTPUT").expect("BANEWFN_TEST_OUTPUT"));
    fs::create_dir(&check).expect("use a new output directory");
    let resources = root.join("resources");
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    std::env::set_var(
        "MULTIWFN_WORKFLOW_RUNNER",
        resources.join(format!("tools/multiwfn-workflow{suffix}")),
    );
    std::env::set_var("MULTIWFN_WORKFLOW_CONF", resources.join("workflows/conf"));
    let library = check.join("scripts");
    fs::create_dir(&library).unwrap();
    fs::copy(
        resources.join("workflows/scripts/density.bw"),
        library.join("density.bw"),
    )
    .unwrap();
    let chemical = std::env::var_os("BANEWFN_TEST_STARTUP");
    let input = if let Some(source) = chemical.as_ref() {
        let source = PathBuf::from(source);
        let target = check.join(source.file_name().unwrap());
        fs::copy(source, &target).unwrap();
        fs::copy(
            resources.join("workflows/scripts/mayer.bwc"),
            library.join("analysis.bwc"),
        )
        .unwrap();
        target
    } else {
        let target = check.join("single atom.xyz");
        fs::write(&target, "1\nWorkbench fixture\nHe 0 0 0\n").unwrap();
        fs::write(
            library.join("analysis.bw"),
            "%raw\nxyz\nexport.xyz\nq\nend\n",
        )
        .unwrap();
        target
    };
    std::env::set_var("MULTIWFN_WORKFLOW_LIBRARY", &library);
    let service = WorkbenchService::start(
        resources.join("frontend/matterviz-viewer/dist"),
        root.join(format!("Multiwfn_MatterVizGUI{suffix}")),
        Some(&input),
        None,
    )
    .unwrap();
    let page = url::Url::parse(&service.url).unwrap();
    let status = request(&page, "status", None);
    assert_eq!(status["session"], Value::Null);
    assert!(status["results"].as_str().unwrap().contains("_workflows"));
    let parameters = json!({"0/0/grid":"2"});
    let inspected = request(
        &page,
        "inspect",
        Some(json!({"script":"density.bw","parameters":parameters})),
    );
    assert_eq!(inspected["fields"][0]["type"], "select");
    assert_eq!(inspected["fields"][0]["value"], "2");
    assert!(inspected["tasks"][0]["commands"]
        .as_str()
        .unwrap()
        .starts_with("5\n1\n2\n"));
    let script = if chemical.is_some() {
        "analysis.bwc"
    } else {
        "analysis.bw"
    };
    request(
        &page,
        "run",
        Some(json!({"script":script,"cores":1,"variables":[],"parameters":{},"dryRun":false})),
    );
    let deadline = Instant::now() + Duration::from_secs(120);
    let job = loop {
        let status = request(&page, "status", None);
        if status["job"]["state"] != "running" {
            break status["job"].clone();
        }
        assert!(Instant::now() < deadline, "workflow timed out");
        std::thread::sleep(Duration::from_millis(100));
    };
    service.shutdown();
    assert_eq!(job["state"], "completed", "{job}");
    assert_eq!(job["exitCode"], 0);
    let directory = PathBuf::from(job["directory"].as_str().unwrap());
    assert!(directory.join("parameters.json").is_file());
    if chemical.is_some() {
        let out = fs::read_dir(&directory)
            .unwrap()
            .filter_map(Result::ok)
            .find(|e| e.path().extension().is_some_and(|s| s == "out"))
            .unwrap();
        let text = fs::read_to_string(out.path()).unwrap();
        assert!(
            text.contains("Mayer") && text.contains("bond"),
            "missing Mayer analysis"
        );
    } else {
        assert!(directory.join("export.xyz").is_file());
    }
    println!("Independent workbench passed: {}", directory.display());
}
