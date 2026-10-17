//! Opt-in native batch acceptance. Only one-atom XYZ I/O is executed.
use matterviz_volume_e2e::{workflow_batch::WorkflowBatch, workflows::WorkflowManager};
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

fn wait(batch: &WorkflowBatch, predicate: impl Fn(&Value) -> bool) -> Value {
    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        let state = batch.status();
        if predicate(&state["batch"]) {
            return state["batch"].clone();
        }
        assert!(Instant::now() < deadline, "{state}");
        thread::sleep(Duration::from_millis(30));
    }
}
#[test]
#[ignore = "requires packaged workflow runner, engine and Bash"]
fn batch_keeps_inputs_attempts_bindings_and_native_array_sweeps_separate() {
    let package = PathBuf::from(std::env::var_os("BANEWFN_TEST_PACKAGE").unwrap());
    let check = PathBuf::from(std::env::var_os("BANEWFN_TEST_OUTPUT").unwrap());
    fs::create_dir(&check).unwrap();
    let library = check.join("scripts");
    fs::create_dir(&library).unwrap();
    let sources = check.join("inputs");
    fs::create_dir(&sources).unwrap();
    let mut files = Vec::new();
    for (folder, name) in [("a", "相同 sample"), ("b", "相同 sample"), ("c", "fail")] {
        fs::create_dir(sources.join(folder)).unwrap();
        let file = sources.join(folder).join(format!("{name}.xyz"));
        fs::write(&file, "1\nI/O fixture\nHe 0 0 0\n").unwrap();
        fs::write(file.with_extension("log"), "Companion fixture\n").unwrap();
        files.push(file);
    }
    let allow = check
        .join("allow-retry")
        .to_string_lossy()
        .replace('\\', "/");
    let original=format!("state=(1 2)\n[io]\nlogfile ?\n%command\n#!/bin/bash\nmv -- \"export.xyz\" \"${{input}}_${{state}}.xyz\"\nif [ \"${{input}}\" = fail ] && [ ! -f \"{allow}\" ]; then exit 1; fi\nsleep 0.2\nend\n");
    fs::write(library.join("run.bw"), &original).unwrap();
    fs::write(
        library.join("io.conf"),
        "[main]\nxyz\nexport.xyz\n[quit]\nq\n",
    )
    .unwrap();
    let resources = package.join("resources");
    let suffix = std::env::consts::EXE_SUFFIX;
    std::env::set_var(
        "MULTIWFN_WORKFLOW_RUNNER",
        resources.join(format!("tools/multiwfn-workflow{suffix}")),
    );
    std::env::set_var("MULTIWFN_WORKFLOW_CONF", resources.join("workflows/conf"));
    std::env::set_var("MULTIWFN_WORKFLOW_LIBRARY", &library);
    let manager = Arc::new(WorkflowManager::standalone(
        package.join(format!("Multiwfn_MatterVizGUI{suffix}")),
        None,
    ));
    manager.select("script", &library.join("run.bw")).unwrap();
    let batch = WorkflowBatch::new(manager.clone());
    let planned = manager.status();
    assert!(planned["job"].is_null());
    let discovery =
        std::process::Command::new(resources.join(format!("tools/multiwfn-workflow{suffix}")))
            .arg("--plan-json")
            .arg(library.join("run.bw"))
            .arg("--root")
            .arg(&sources)
            .args(["--pattern", "*.xyz", "--recursive", "--file"])
            .arg(&files[0])
            .args(["--binding", "0/main/logfile=${input}.log"])
            .output()
            .unwrap();
    assert!(
        discovery.status.success(),
        "{}",
        String::from_utf8_lossy(&discovery.stdout)
    );
    let plan: Value = serde_json::from_slice(&discovery.stdout).unwrap();
    assert_eq!(plan["inputs"].as_array().unwrap().len(), 3);
    assert_eq!(plan["combinations"], 2);
    assert!(plan["inputs"]
        .as_array()
        .unwrap()
        .iter()
        .all(|input| input["errors"].as_array().unwrap().is_empty()));
    batch.select_inputs(&json!({"files":files})).unwrap();
    let request = json!({"script":"run.bw","cores":1,"variables":[],"parameters":{},"bindings":{"0/main/logfile":"${input}.log"},"dryRun":false});
    let started = batch.start(&request).unwrap();
    let id = started["batch"]["id"].as_str().unwrap();
    wait(&batch, |b| b["cases"][0]["state"] == "running");
    batch
        .control(&json!({"batch":id,"action":"pause"}))
        .unwrap();
    let paused = wait(&batch, |b| b["state"] == "paused");
    assert_eq!(paused["counts"]["completed"], 1);
    assert_eq!(paused["counts"]["waiting"], 2);
    let first = batch.detail(&json!({"batch":id,"item":"0001"})).unwrap();
    assert_eq!(first["job"]["state"], "completed");
    let directory = PathBuf::from(first["job"]["directory"].as_str().unwrap());
    for state in [1, 2] {
        assert!(directory.join(format!("相同 sample_{state}.xyz")).is_file());
    }
    let params: Value =
        serde_json::from_slice(&fs::read(directory.join("parameters.json")).unwrap()).unwrap();
    assert!(params["0/main/logfile"].as_str().unwrap().contains("a"));
    assert!(params["0/main/logfile"]
        .as_str()
        .unwrap()
        .ends_with("相同 sample.log"));
    fs::write(
        library.join("run.bw"),
        "%command\necho unexpected > wrong-workflow\nend\n",
    )
    .unwrap();
    batch
        .control(&json!({"batch":id,"action":"resume"}))
        .unwrap();
    let ended = wait(&batch, |b| b["state"] == "partial");
    assert_eq!(ended["counts"]["completed"], 2);
    assert_eq!(ended["counts"]["failed"], 1);
    let second = batch.detail(&json!({"batch":id,"item":"0002"})).unwrap();
    assert_ne!(first["job"]["directory"], second["job"]["directory"]);
    assert!(batch
        .detail(&json!({"batch":"stale","item":"0001"}))
        .is_err());
    let failed = batch
        .detail(&json!({"batch":id,"item":"0003","attempt":1}))
        .unwrap();
    fs::write(check.join("allow-retry"), "allow\n").unwrap();
    batch
        .control(&json!({"batch":id,"action":"retry"}))
        .unwrap();
    let finished = wait(&batch, |b| b["state"] == "completed");
    assert_eq!(finished["counts"]["completed"], 3);
    assert_eq!(finished["cases"][0]["attempts"], 1);
    assert_eq!(finished["cases"][2]["attempts"], 2);
    let retried = batch.detail(&json!({"batch":id,"item":"0003"})).unwrap();
    assert_ne!(failed["job"]["directory"], retried["job"]["directory"]);
    assert_eq!(
        batch
            .detail(&json!({"batch":id,"item":"0003","attempt":1}))
            .unwrap()["job"]["state"],
        "failed"
    );
    let root = PathBuf::from(finished["directory"].as_str().unwrap());
    let restored = WorkflowBatch::new(manager.clone());
    assert_eq!(
        restored.load(&root).unwrap()["batch"]["counts"]["completed"],
        3
    );
    let mut manifest: Value =
        serde_json::from_slice(&fs::read(root.join("batch.json")).unwrap()).unwrap();
    manifest["state"] = json!("running");
    manifest["cases"][2]["state"] = json!("running");
    manifest["cases"][2]["attempts"][1]["state"] = json!("running");
    fs::write(
        root.join("batch.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    assert_eq!(
        restored.load(&root).unwrap()["batch"]["cases"][2]["state"],
        "interrupted"
    );
    assert!(!restored.active());
    manifest["cases"][0]["attempts"][0]["directory"] = json!("../escape");
    fs::write(
        root.join("batch.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    assert!(restored.load(&root).is_err());
    // Restore the valid terminal manifest after the rejection check.
    manifest["state"] = json!("completed");
    manifest["cases"][2]["state"] = json!("completed");
    manifest["cases"][2]["attempts"][1]["state"] = json!("completed");
    manifest["cases"][0]["attempts"][0]["directory"] = json!(directory
        .strip_prefix(&root)
        .unwrap()
        .to_string_lossy()
        .replace('\\', "/"));
    fs::write(
        root.join("batch.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    fs::write(library.join("run.bw"), original).unwrap();
    let next = batch.start(&request).unwrap();
    let next_id = next["batch"]["id"].as_str().unwrap();
    wait(&batch, |b| b["cases"][0]["state"] == "running");
    batch
        .control(&json!({"batch":next_id,"action":"cancel"}))
        .unwrap();
    let cancelled = wait(&batch, |b| b["state"] == "cancelled");
    assert_eq!(cancelled["counts"]["cancelled"], 3);
    assert_eq!(cancelled["cases"][1]["attempts"], 0);
    batch.shutdown();
    assert!(batch.start(&request).unwrap_err().contains("closing"));
    println!("Batch native acceptance passed: {}", root.display());
}
