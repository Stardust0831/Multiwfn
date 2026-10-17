//! Execution observations and bounded log ranges from the shared BaneWfn core.
use crate::workflows::Job;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const TRACE: &str = ".banewfn-events.jsonl";
const MAX_EVENTS: u64 = 8 * 1024 * 1024;
const MAX_PLAN: u64 = 512 * 1024;
const MAX_LOG: u64 = 256 * 1024;

fn contained(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err("Invalid workflow log".into());
    }
    Ok(path)
}
pub(crate) fn graph(job: &Job) -> Result<Value, String> {
    if !job.directory.join(TRACE).exists() {
        return Ok(json!({"available":false,"steps":[],"groups":[],"truncated":false}));
    }
    let path = contained(&job.directory, &job.directory.join(TRACE))?;
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let length = file.metadata().map_err(|e| e.to_string())?.len();
    let mut first = String::new();
    BufReader::new((&mut file).take(MAX_PLAN))
        .read_line(&mut first)
        .map_err(|e| e.to_string())?;
    // A writer may be between creation and its first complete record.
    if !first.ends_with('\n') {
        return Ok(json!({"available":false,"steps":[],"groups":[],"truncated":false}));
    }
    let plan: Value = serde_json::from_str(&first).map_err(|_| "Invalid execution record")?;
    let steps = plan["steps"]
        .as_array()
        .filter(|v| v.len() <= 4096)
        .ok_or("Invalid execution plan")?;
    if plan["version"] != 1
        || plan["event"] != "plan"
        || steps
            .iter()
            .any(|s| !s["label"].is_string() || !s["kind"].is_string() || !s["sections"].is_array())
    {
        return Err("Invalid execution plan".into());
    }
    let start = length.saturating_sub(MAX_EVENTS);
    file.seek(SeekFrom::Start(start))
        .map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(file.take(MAX_EVENTS));
    if start > 0 {
        let mut partial = Vec::new();
        reader
            .read_until(b'\n', &mut partial)
            .map_err(|e| e.to_string())?;
    }
    let mut groups = Vec::<Value>::new();
    let mut indices = BTreeMap::new();
    let group_limit = (16384 / steps.len().max(1)).clamp(1, 1024);
    let mut dropped = false;
    for line in reader.split(b'\n') {
        let line = line.map_err(|e| e.to_string())?;
        let Ok(event) = serde_json::from_slice::<Value>(&line) else {
            continue;
        };
        if event["version"] != 1 {
            continue;
        }
        let Some(id) = event["group"].as_str() else {
            continue;
        };
        if event["event"] == "move" {
            for group in &mut groups {
                for node in group["nodes"].as_array_mut().unwrap() {
                    if node["output"].is_object()
                        && node["output"]["file"] == event["source"]
                        && event["destination"].is_string()
                    {
                        node["output"]["file"] = event["destination"].clone();
                    }
                }
            }
            continue;
        }
        if event["event"] == "iteration" {
            if groups.len() >= group_limit {
                dropped = true;
                groups.remove(0);
                indices.clear();
                for (i, g) in groups.iter().enumerate() {
                    indices.insert(g["id"].as_str().unwrap().to_owned(), i);
                }
            }
            if indices.contains_key(id) {
                continue;
            }
            indices.insert(id.to_owned(), groups.len());
            groups.push(json!({"id":id,"file":event["file"],"combination":event["combination"],"combinations":event["combinations"],"variables":event["variables"],"nodes":steps.iter().enumerate().map(|(i,_)|json!({"index":i,"state":"waiting","phase":"","failedPhase":"","start":null,"end":null,"started":null,"finished":null,"output":null})).collect::<Vec<_>>()}));
            continue;
        }
        let Some(&index) = indices.get(id) else {
            continue;
        };
        let Some(task) = event["task"].as_u64().filter(|&i| i < steps.len() as u64) else {
            continue;
        };
        let node = &mut groups[index]["nodes"][task as usize];
        match event["event"].as_str() {
            Some("start") => {
                node["state"] = json!("running");
                node["start"] = event["offset"].clone();
                node["started"] = event["time"].clone();
            }
            Some("phase") => {
                node["phase"] = event["phase"].clone();
                if event["output"].as_str().is_some_and(|s| !s.is_empty()) {
                    node["output"] =
                        json!({"file":event["output"],"start":event["outputOffset"],"end":null});
                }
            }
            Some("phase-end") => {
                if event["success"] == false && node["failedPhase"] == "" {
                    node["failedPhase"] = event["phase"].clone();
                }
                if event["phase"] == "multiwfn" && node["output"].is_object() {
                    node["output"]["end"] = event["outputOffset"].clone();
                }
            }
            Some("finish") => {
                if event["failedPhase"].as_str().is_some_and(|s| !s.is_empty()) {
                    node["failedPhase"] = event["failedPhase"].clone();
                }
                if matches!(
                    event["state"].as_str(),
                    Some("completed" | "failed" | "prepared")
                ) {
                    node["state"] = event["state"].clone();
                }
                node["end"] = event["offset"].clone();
                node["finished"] = event["time"].clone();
            }
            _ => {}
        }
    }
    for group in &mut groups {
        for node in group["nodes"].as_array_mut().unwrap() {
            if !matches!(job.state, "running" | "cancelling") {
                if node["state"] == "running" {
                    node["state"] = json!(if job.state == "failed" {
                        "failed"
                    } else if job.state == "cancelled" {
                        "cancelled"
                    } else {
                        "interrupted"
                    });
                    if job.state == "failed" && node["failedPhase"] == "" {
                        node["failedPhase"] = node["phase"].clone();
                    }
                } else if node["state"] == "waiting" {
                    node["state"] = json!("not-run");
                }
            }
        }
    }
    Ok(
        json!({"available":true,"steps":steps,"groups":groups,"truncated":start>0||dropped,"directory":job.directory}),
    )
}
pub(crate) fn read(job: &Job, request: &Value) -> Result<Value, String> {
    if request["directory"] != json!(job.directory) {
        return Err("The displayed workflow has changed; refresh its results".into());
    }
    if request.get("group").is_none() {
        return graph(job);
    }
    let graph = graph(job)?;
    let group = graph["groups"]
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["id"] == request["group"])
        .ok_or("Execution group is unavailable")?;
    let index = request["step"].as_u64().ok_or("Invalid execution step")?;
    let node = group["nodes"]
        .as_array()
        .unwrap()
        .get(index as usize)
        .ok_or("Invalid execution step")?;
    let (file, start, end) = match request["source"].as_str() {
        Some("driver") => (
            "workflow.log",
            node["start"].as_u64().ok_or("This step has no log yet")?,
            node["end"].as_u64(),
        ),
        Some("multiwfn") => (
            node["output"]["file"]
                .as_str()
                .ok_or("This step has no Multiwfn output")?,
            node["output"]["start"].as_u64().unwrap_or(0),
            node["output"]["end"].as_u64(),
        ),
        _ => return Err("Invalid log source".into()),
    };
    let root = &job.directory;
    let mut relative = file.to_owned();
    if !root.join(file).is_file() && request["source"] == "multiwfn" {
        let wanted = Path::new(file).file_name();
        let matches: Vec<_> = crate::workflow_results::files(root)
            .into_iter()
            .filter(|name| Path::new(name).file_name() == wanted)
            .collect();
        if matches.len() == 1 {
            relative = matches[0].clone();
        }
    }
    let path = contained(root, &root.join(&relative))?;
    let mut stream = File::open(path).map_err(|e| e.to_string())?;
    let length = stream.metadata().map_err(|e| e.to_string())?.len();
    let end = end.unwrap_or(length).min(length);
    if start > end {
        return Err("Step log has been replaced or truncated".into());
    }
    let from = start.max(end.saturating_sub(MAX_LOG));
    stream
        .seek(SeekFrom::Start(from))
        .map_err(|e| e.to_string())?;
    let mut data = Vec::new();
    stream
        .take(end - from)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&data);
    Ok(
        json!({"file":relative,"text":text,"truncated":from>start,"start":from,"end":end,"step":index,"group":request["group"],"source":request["source"]}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    };
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    struct Fixture {
        job: Job,
    }
    impl Fixture {
        fn new(state: &'static str) -> Self {
            let directory = std::env::temp_dir().join(format!(
                "workflow-trace-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&directory).unwrap();
            Self {
                job: Job {
                    directory,
                    state,
                    code: None,
                    message: String::new(),
                    cancel: Arc::new(AtomicBool::new(false)),
                },
            }
        }
        fn events(&self, extra: Vec<Value>) {
            let mut events = vec![
                json!({"version":1,"event":"plan","steps":[{"label":"grid","kind":"multiwfn","sections":["electron","esp"],"origin":""},{"label":"%command","kind":"command","sections":[],"origin":""}]}),
            ];
            events.extend(extra);
            fs::write(
                self.job.directory.join(TRACE),
                events
                    .iter()
                    .map(|e| e.to_string() + "\n")
                    .collect::<String>(),
            )
            .unwrap();
        }
        fn request(&self) -> Value {
            json!({"directory":self.job.directory,"group":"1-1","step":0,"source":"driver"})
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.job.directory);
        }
    }
    fn event(kind: &str, details: Value) -> Value {
        let mut value = json!({"version":1,"group":"1-1","task":0,"event":kind,"time":100});
        value
            .as_object_mut()
            .unwrap()
            .extend(details.as_object().unwrap().clone());
        value
    }
    #[test]
    fn ranges_select_the_requested_step_and_keep_native_output_after_collection() {
        let f = Fixture::new("failed");
        f.events(vec![event("iteration",json!({"file":"sample.fch","combination":1,"combinations":2,"variables":{"state":"1"}})),event("start",json!({"offset":5})),event("phase",json!({"phase":"multiwfn","output":"grid_sample.out","outputOffset":0})),event("phase-end",json!({"phase":"multiwfn","success":true,"outputOffset":6})),event("phase",json!({"phase":"command"})),event("phase-end",json!({"phase":"command","success":false})),event("finish",json!({"state":"failed","offset":10})),event("move",json!({"source":"grid_sample.out","destination":"collected/grid_sample.out"}))]);
        fs::write(f.job.directory.join("workflow.log"), "head\nstep\nlater\n").unwrap();
        fs::write(f.job.directory.join("grid_sample.out"), "wrong iteration").unwrap();
        fs::create_dir(f.job.directory.join("collected")).unwrap();
        fs::write(
            f.job.directory.join("collected/grid_sample.out"),
            "nativeSECOND",
        )
        .unwrap();
        let graph = graph(&f.job).unwrap();
        assert_eq!(graph["groups"][0]["nodes"][0]["failedPhase"], "command");
        assert_eq!(graph["groups"][0]["nodes"][1]["state"], "not-run");
        assert_eq!(read(&f.job, &f.request()).unwrap()["text"], "step\n");
        let mut request = f.request();
        request["source"] = json!("multiwfn");
        let native = read(&f.job, &request).unwrap();
        assert_eq!(native["text"], "native");
        assert_eq!(native["file"], "collected/grid_sample.out");
        request["directory"] = json!("stale");
        assert!(read(&f.job, &request).is_err());
    }
    #[test]
    fn cancellation_and_interruption_are_not_reported_as_computational_failures() {
        for (state, expected) in [
            ("running", "running"),
            ("cancelled", "cancelled"),
            ("interrupted", "interrupted"),
            ("failed", "failed"),
        ] {
            let f = Fixture::new(state);
            f.events(vec![
                event(
                    "iteration",
                    json!({"file":"sample","combination":1,"combinations":1,"variables":{}}),
                ),
                event("start", json!({"offset":0})),
            ]);
            assert_eq!(
                graph(&f.job).unwrap()["groups"][0]["nodes"][0]["state"],
                expected
            );
            let mut request = f.request();
            request["step"] = json!(999);
            assert!(read(&f.job, &request).is_err());
        }
    }
    #[test]
    fn missing_and_partially_written_records_keep_original_logs_accessible() {
        let f = Fixture::new("running");
        assert_eq!(graph(&f.job).unwrap()["available"], false);
        fs::write(f.job.directory.join(TRACE), "{\"version\":1").unwrap();
        assert_eq!(graph(&f.job).unwrap()["available"], false);
    }
    #[cfg(unix)]
    #[test]
    fn trace_and_log_paths_cannot_escape_the_attempt() {
        let f = Fixture::new("completed");
        std::os::unix::fs::symlink("/etc/passwd", f.job.directory.join(TRACE)).unwrap();
        assert!(graph(&f.job).is_err());
        fs::remove_file(f.job.directory.join(TRACE)).unwrap();
        f.events(vec![
            event(
                "iteration",
                json!({"file":"sample","combination":1,"combinations":1,"variables":{}}),
            ),
            event("start", json!({"offset":0})),
        ]);
        std::os::unix::fs::symlink("/etc/passwd", f.job.directory.join("workflow.log")).unwrap();
        assert!(read(&f.job, &f.request()).is_err());
    }
}
