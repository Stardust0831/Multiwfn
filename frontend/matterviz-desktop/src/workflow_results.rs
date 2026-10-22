//! Presentation metadata for workflow outputs; Cube parsing stays in MatterViz.
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

static VIEW_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const SETTINGS: &str = ".banewfn-view-settings.json";

/// Bounded, deterministic listing. Never follow output symlinks into other jobs.
pub fn files(root: &Path) -> Vec<String> {
    fn walk(root: &Path, dir: &Path, depth: usize, found: &mut Vec<String>, budget: &mut usize) {
        if depth > 8 || *budget == 0 {
            return;
        }
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        let mut entries: Vec<_> = entries.take(*budget).filter_map(Result::ok).collect();
        *budget = budget.saturating_sub(entries.len());
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if name.starts_with('.') || name == "conf" {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                walk(root, &entry.path(), depth + 1, found, budget);
            } else if kind.is_file() {
                if let Ok(relative) = entry.path().strip_prefix(root) {
                    found.push(relative.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
    let mut result = Vec::new();
    walk(root, root, 0, &mut result, &mut 2048);
    result.sort();
    result
}

fn classify(file: &str) -> Option<Value> {
    let path = Path::new(file);
    if !matches!(
        path.extension()?.to_str()?.to_ascii_lowercase().as_str(),
        "cub" | "cube"
    ) {
        return None;
    }
    let stem = path.file_stem()?.to_str()?;
    let (base, suffix) = stem.rsplit_once('_').unwrap_or((stem, ""));
    let suffix = suffix.to_ascii_lowercase();
    let orbital = suffix
        .strip_prefix("oh")
        .map(|n| ("HOMO", "−", n))
        .or_else(|| suffix.strip_prefix("ol").map(|n| ("LUMO", "+", n)))
        .filter(|(_, _, n)| n.is_empty() || n.bytes().all(|c| c.is_ascii_digit()));
    let kind = match suffix.as_str() {
        "den" => "density",
        "esp" => "esp",
        "elf" => "elf",
        "lol" => "lol",
        "ole" | "hole" => "hole",
        "ele" | "electron" => "electron",
        _ if orbital.is_some() => "orbital",
        _ => "generic",
    };
    let mut group = if kind == "generic" { stem } else { base };
    let mut unit = None;
    if kind == "esp" {
        if let Some((base, token)) = base.rsplit_once('_') {
            unit = match token.to_ascii_lowercase().as_str() {
                "au" => Some("au"),
                "kcal" => Some("kcal/mol"),
                _ => None,
            };
            if unit.is_some() {
                group = base;
            }
        }
    }
    let orbital = orbital.map(|(label, sign, n)| {
        if n.is_empty() || n == "0" {
            label.to_owned()
        } else {
            format!("{label}{sign}{n}")
        }
    });
    Some(
        json!({"file":file, "kind":kind, "group":path.parent().unwrap_or(Path::new("")).join(group).to_string_lossy(), "unit":unit, "unitDeclared":unit.is_some(), "orbital":orbital}),
    )
}

fn settings(root: &Path) -> Value {
    let path = root.join(SETTINGS);
    if fs::symlink_metadata(&path).is_ok_and(|m| m.is_file() && m.len() < 128 * 1024) {
        fs::read(path)
            .ok()
            .and_then(|s| serde_json::from_slice(&s).ok())
            .unwrap_or(json!({}))
    } else {
        json!({})
    }
}

pub fn cubes(root: &Path, files: &[String]) -> Vec<Value> {
    let saved = settings(root);
    let mut cubes: Vec<_> = files.iter().filter_map(|f| classify(f)).collect();
    for idx in 0..cubes.len() {
        if cubes[idx]["kind"] != "esp" {
            continue;
        }
        let partners: Vec<_> = cubes
            .iter()
            .filter(|c| c["kind"] == "density" && c["group"] == cubes[idx]["group"])
            .map(|c| c["file"].clone())
            .collect();
        cubes[idx]["density"] = if partners.len() == 1 {
            partners[0].clone()
        } else {
            Value::Null
        };
        if cubes[idx]["unit"].is_null() {
            let value = &saved[cubes[idx]["file"].as_str().unwrap_or("")];
            if matches!(value.as_str(), Some("au" | "kcal/mol")) {
                cubes[idx]["unit"] = value.clone();
            }
        }
    }
    cubes
}

fn entry(file: &str, cube: &Value) -> Value {
    // The staging session is flat; URL-encode special characters and Unicode.
    let mut url = url::Url::parse("http://localhost/").unwrap();
    url.path_segments_mut()
        .unwrap()
        .push(Path::new(file).file_name().unwrap().to_str().unwrap());
    let mut entry = json!({"path":url.path().trim_start_matches('/'), "name":Path::new(file).file_stem().unwrap().to_string_lossy()});
    match cube["kind"].as_str().unwrap_or("generic") {
        "orbital" => {
            entry["role"] = json!("orbital");
            entry["mode"] = json!("signed");
            entry["isovalue"] = json!(0.02);
        }
        "elf" | "lol" => {
            entry["isovalue"] = json!(0.5);
        }
        _ => {
            entry["isovalue"] = json!(0.001);
        }
    }
    entry
}

/// Select files by exact catalogue membership, never by joining request paths.
fn plan_file(
    root: &Path,
    request: &Value,
    catalog: &[Value],
    saved: &mut Value,
) -> Result<Value, String> {
    let file = request["file"].as_str().ok_or("Select a Cube result")?;
    let selected = catalog
        .iter()
        .find(|c| c["file"] == file)
        .ok_or("Cube result is no longer available")?;
    let mut entries = vec![entry(file, selected)];
    let mut sources = vec![root.join(file)];
    if selected["kind"] == "esp" {
        let density = selected["density"]
            .as_str()
            .ok_or("ESP needs one matching _den Cube in the same folder")?;
        // A filename declaration takes precedence over all remembered choices.
        let declared = classify(file).unwrap();
        let unit = declared["unit"]
            .as_str()
            .or(request["unit"].as_str())
            .or(selected["unit"].as_str())
            .filter(|unit| matches!(*unit, "au" | "kcal/mol"))
            .ok_or("Choose the ESP data unit")?;
        entries[0]["analysisKind"] = json!("esp-potential");
        entries[0]["valueUnit"] = json!(unit);
        entries[0]["visible"] = json!(false);
        let mut surface = entry(density, &json!({"kind":"density"}));
        surface["analysisKind"] = json!("esp-density");
        surface["colorMapping"] = json!({"path":entries[0]["path"], "range":[-0.05,0.05], "stops":[{"position":0,"color":"#f5a9b8"},{"position":0.5,"color":"#ffffff"},{"position":1,"color":"#5bcefa"}]});
        entries.insert(0, surface);
        sources.insert(0, root.join(density));
        if declared["unit"].is_null() {
            if !saved.is_object() {
                *saved = json!({});
            }
            saved[file] = json!(unit);
        }
    }
    for source in &sources {
        if !source
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(root.canonicalize().map_err(|e| e.to_string())?)
        {
            return Err("Cube result is outside the workflow folder".into());
        }
    }
    Ok(json!({"sources":sources, "manifest":{"cubes":entries}}))
}

/// Build one viewer session for the complete selection. Validate every file
/// before persisting unit choices or launching any window.
pub fn plan(root: &Path, request: &Value) -> Result<Value, String> {
    let catalog = cubes(root, &files(root));
    let original_settings = settings(root);
    let mut saved = original_settings.clone();
    let result = if let Some(selection) = request.get("files") {
        let selection = selection
            .as_array()
            .filter(|a| !a.is_empty() && a.len() <= 64)
            .ok_or("Select between 1 and 64 Cube results")?;
        let mut seen = BTreeSet::new();
        let mut plans = Vec::new();
        for value in selection {
            let file = value.as_str().ok_or("Invalid Cube selection")?;
            if !seen.insert(file) {
                continue;
            }
            plans.push(
                plan_file(
                    root,
                    &json!({"file":file,"unit":request["units"][file]}),
                    &catalog,
                    &mut saved,
                )
                .map_err(|error| format!("{file}: {error}"))?,
            );
        }
        // A selected density already used for ESP need not appear again as an
        // opaque, unmapped surface. Different ESP maps may share its source.
        let mapped: BTreeSet<String> = plans
            .iter()
            .filter(|p| p["sources"].as_array().unwrap().len() == 2)
            .map(|p| p["sources"][0].as_str().unwrap().to_owned())
            .collect();
        let mut sources: Vec<Value> = Vec::new();
        let mut destinations: Vec<String> = Vec::new();
        let mut entries: Vec<Value> = Vec::new();
        for plan in plans {
            let local_sources = plan["sources"].as_array().unwrap();
            if local_sources.len() == 1 && mapped.contains(local_sources[0].as_str().unwrap()) {
                continue;
            }
            let local_entries = plan["manifest"]["cubes"].as_array().unwrap();
            let mut paths = Vec::new();
            for source in local_sources {
                // Distinct ESP surfaces need distinct representation identities,
                // even when they map different potentials onto the same density.
                let index = sources.len();
                let name = Path::new(source.as_str().unwrap())
                    .file_name()
                    .unwrap()
                    .to_string_lossy();
                destinations.push(format!("{index:03}_{name}"));
                sources.push(source.clone());
                paths.push(entry(&destinations[index], &json!({}))["path"].clone());
            }
            for (index, old) in local_entries.iter().enumerate() {
                let mut item = old.clone();
                item["path"] = paths[index].clone();
                item["name"] = json!(Path::new(local_sources[index].as_str().unwrap())
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/"));
                if let Some(mapping) = old["colorMapping"]["path"].as_str() {
                    let target = local_entries
                        .iter()
                        .position(|e| e["path"] == mapping)
                        .unwrap();
                    item["colorMapping"]["path"] = paths[target].clone();
                }
                if !entries.contains(&item) {
                    entries.push(item);
                }
            }
        }
        json!({"sources":sources,"destinations":destinations,"manifest":{"cubes":entries}})
    } else {
        plan_file(root, request, &catalog, &mut saved)?
    };
    if saved != original_settings {
        let path = root.join(SETTINGS);
        if fs::symlink_metadata(&path).is_ok_and(|m| !m.is_file()) {
            return Err("Invalid result settings file".into());
        }
        fs::write(
            path,
            serde_json::to_vec_pretty(&saved).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(result)
}

/// Each viewer owns its scratch session until its WebView closes. Source data
/// remain untouched; hard links avoid duplicating large grids on the same disk.
pub struct ViewSession(pub PathBuf);
impl Drop for ViewSession {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
impl ViewSession {
    pub fn create(plan: &Value) -> Result<Self, String> {
        let root = std::env::temp_dir().join(format!(
            "banewfn-view-{}-{}",
            std::process::id(),
            VIEW_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).map_err(|e| e.to_string())?;
        let session = Self(root);
        let sources = plan["sources"]
            .as_array()
            .filter(|s| !s.is_empty() && s.len() <= 128)
            .ok_or("Invalid Cube view")?;
        let destinations = plan
            .get("destinations")
            .map(|value| {
                value
                    .as_array()
                    .filter(|a| a.len() == sources.len())
                    .ok_or("Invalid Cube destinations")
            })
            .transpose()?;
        for (index, source) in sources.iter().enumerate() {
            let path = Path::new(source.as_str().ok_or("Invalid Cube path")?);
            let name = if let Some(names) = destinations {
                names[index].as_str().ok_or("Invalid Cube filename")?
            } else {
                path.file_name()
                    .and_then(|p| p.to_str())
                    .ok_or("Invalid Cube filename")?
            };
            if name.contains(['/', '\\']) || name == "." || name == ".." || name.is_empty() {
                return Err("Invalid Cube filename".into());
            }
            let destination = session.0.join(name);
            if destination.exists() {
                return Err("Duplicate Cube filename".into());
            }
            if fs::hard_link(path, &destination).is_err() {
                fs::copy(path, &destination).map_err(|e| e.to_string())?;
            }
        }
        fs::write(
            session.0.join("manifest.json"),
            serde_json::to_vec_pretty(&plan["manifest"]).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok(session)
    }
}

pub fn launch(plan: &Value, frontend: &Path) -> Result<Value, String> {
    let mut command = Command::new(std::env::current_exe().map_err(|e| e.to_string())?);
    command
        .arg("--workflow-result")
        .arg(frontend)
        // This independent window must not report startup for its parent.
        .env_remove("MULTIWFN_MATTERVIZ_STARTUP_STATUS")
        .env_remove("MULTIWFN_MATTERVIZ_STARTUP_TOKEN")
        .stdin(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let result = child
        .stdin
        .take()
        .ok_or("Missing viewer input")
        .and_then(|mut stdin| {
            stdin
                .write_all(&serde_json::to_vec(plan).unwrap())
                .map_err(|_| "Cannot send result to viewer")
        });
    if let Err(error) = result {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error.into());
    }
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(json!({"opened":true}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(names: &[&str]) -> ViewSession {
        let root = std::env::temp_dir().join(format!(
            "banewfn-results-test-{}-{}",
            std::process::id(),
            VIEW_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        for name in names {
            let path = root.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "unchanged cube").unwrap();
        }
        ViewSession(root)
    }

    #[test]
    fn selection_bundles_colliding_names_and_preserves_explicit_maps() {
        let root = fixture(&[
            "a/x_den.cub",
            "a/x_kcal_esp.cub",
            "b/x_den.cub",
            "b/x_au_esp.cub",
            "x_oH.cub",
        ]);
        let bundle = plan(&root.0, &json!({"files":["a/x_den.cub", "a/x_kcal_esp.cub", "b/x_au_esp.cub", "x_oH.cub", "x_oH.cub"]})).unwrap();
        assert_eq!(bundle["sources"].as_array().unwrap().len(), 5);
        let entries = bundle["manifest"]["cubes"].as_array().unwrap();
        assert_eq!(entries.len(), 5); // No duplicate plain density or orbital.
        for (surface, potential) in [(0, 1), (2, 3)] {
            assert_eq!(
                entries[surface]["colorMapping"]["path"],
                entries[potential]["path"]
            );
        }
        assert_eq!(entries[1]["valueUnit"], "kcal/mol");
        assert_eq!(entries[3]["valueUnit"], "au");
        assert_eq!(entries[4]["mode"], "signed");
        assert_ne!(entries[0]["path"], entries[2]["path"]);
        let view = ViewSession::create(&bundle).unwrap();
        for destination in bundle["destinations"].as_array().unwrap() {
            assert_eq!(
                fs::read_to_string(view.0.join(destination.as_str().unwrap())).unwrap(),
                "unchanged cube"
            );
        }
        let scratch = view.0.clone();
        drop(view);
        assert!(!scratch.exists());
        assert!(root.0.join("a/x_den.cub").is_file());
        fs::write(root.0.join("a/x_au_esp.cub"), "unchanged cube").unwrap();
        let shared = plan(
            &root.0,
            &json!({"files":["a/x_den.cub", "a/x_kcal_esp.cub", "a/x_au_esp.cub"]}),
        )
        .unwrap();
        assert_eq!(shared["manifest"]["cubes"].as_array().unwrap().len(), 4);
        assert_eq!(shared["sources"][0], shared["sources"][2]);
        assert_ne!(
            shared["manifest"]["cubes"][0]["path"],
            shared["manifest"]["cubes"][2]["path"]
        );
    }

    #[test]
    fn invalid_batch_does_not_persist_partial_unit_choices() {
        let root = fixture(&["x_den.cub", "x_esp.cub", "orphan_esp.cub"]);
        assert!(plan(
            &root.0,
            &json!({"files":["x_esp.cub", "../x_den.cub"], "units":{"x_esp.cub":"au"}})
        )
        .is_err());
        assert!(!root.0.join(SETTINGS).exists());
        assert!(
            plan(&root.0, &json!({"files":["x_den.cub", "orphan_esp.cub"]}))
                .unwrap_err()
                .contains("orphan_esp.cub")
        );
        assert!(plan(&root.0, &json!({"files":[]})).is_err());
        assert!(plan(&root.0, &json!({"files":vec!["x_den.cub";65]})).is_err());
        let bundle = plan(
            &root.0,
            &json!({"files":["x_esp.cub"], "units":{"x_esp.cub":"kcal/mol"}}),
        )
        .unwrap();
        assert_eq!(bundle["sources"].as_array().unwrap().len(), 2);
        assert_eq!(settings(&root.0)["x_esp.cub"], "kcal/mol");
        let mut malicious = bundle;
        malicious["destinations"][0] = json!("../outside.cub");
        assert!(ViewSession::create(&malicious).is_err());
    }

    #[test]
    fn vcube_types_stay_terminal_and_units_precede_type() {
        for (name, kind) in [
            ("x_den.cub", "density"),
            ("x_ELF.CUBE", "elf"),
            ("x_lol.cub", "lol"),
            ("x_ole.cub", "hole"),
            ("x_ele.cub", "electron"),
            ("x_oH.cub", "orbital"),
            ("x_oH1.cub", "orbital"),
            ("x_oL12.cub", "orbital"),
            ("x.cub", "generic"),
            ("x_esp_au.cub", "generic"),
        ] {
            assert_eq!(classify(name).unwrap()["kind"], kind, "{name}");
        }
        assert_eq!(classify("x_oH1.cub").unwrap()["orbital"], "HOMO−1");
        assert_eq!(classify("x_oL12.cub").unwrap()["orbital"], "LUMO+12");
        assert_eq!(
            classify("a/苯_au_esp.cub").unwrap()["group"],
            Path::new("a").join("苯").to_string_lossy().as_ref()
        );
        assert_eq!(classify("a/苯_kcal_esp.cub").unwrap()["unit"], "kcal/mol");
    }

    #[test]
    fn pairing_is_local_unique_and_never_guesses_units() {
        let root = fixture(&[
            "ESP/x_den.cub",
            "ESP/x_esp.cub",
            "ESP/x_kcal_esp.cub",
            "other/x_den.cub",
            "z_esp.cub",
        ]);
        assert!(plan(&root.0, &json!({"file":"ESP/x_esp.cub"}))
            .unwrap_err()
            .contains("unit"));
        let chosen = plan(&root.0, &json!({"file":"ESP/x_esp.cub","unit":"kcal/mol"})).unwrap();
        assert_eq!(chosen["manifest"]["cubes"][1]["valueUnit"], "kcal/mol");
        let remembered = plan(&root.0, &json!({"file":"ESP/x_esp.cub"})).unwrap();
        assert_eq!(chosen, remembered);
        let declared = plan(&root.0, &json!({"file":"ESP/x_kcal_esp.cub","unit":"au"})).unwrap();
        assert_eq!(declared["manifest"]["cubes"][1]["valueUnit"], "kcal/mol");
        assert_eq!(
            declared["manifest"]["cubes"][0]["colorMapping"]["path"],
            "x_kcal_esp.cub"
        );
        assert!(plan(&root.0, &json!({"file":"z_esp.cub","unit":"au"}))
            .unwrap_err()
            .contains("matching"));
        fs::write(root.0.join("ESP/x_den.cube"), "duplicate").unwrap();
        assert!(plan(&root.0, &json!({"file":"ESP/x_esp.cub"}))
            .unwrap_err()
            .contains("matching"));
    }

    #[test]
    fn view_sessions_encode_filenames_and_cleanup_without_changing_outputs() {
        let root = fixture(&[
            "ESP/苯 #1_den.cub",
            "ESP/苯 #1_au_esp.cub",
            "conf/hidden.cub",
            ".hidden.cub",
        ]);
        let files = files(&root.0);
        assert_eq!(files.len(), 2);
        assert!(plan(&root.0, &json!({"file":"../outside.cub"})).is_err());
        let plan = plan(&root.0, &json!({"file":"ESP/苯 #1_au_esp.cub"})).unwrap();
        assert!(plan["manifest"]["cubes"][0]["path"]
            .as_str()
            .unwrap()
            .contains("%20%231"));
        let view = ViewSession::create(&plan).unwrap();
        let scratch = view.0.clone();
        assert_eq!(
            fs::read_to_string(scratch.join("苯 #1_den.cub")).unwrap(),
            "unchanged cube"
        );
        drop(view);
        assert!(!scratch.exists());
        assert_eq!(
            fs::read_to_string(root.0.join("ESP/苯 #1_den.cub")).unwrap(),
            "unchanged cube"
        );
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.0.join("ESP/苯 #1_den.cub"), root.0.join("linked.cub"))
                .unwrap();
            assert!(plan_request_rejected(&root.0, "linked.cub"));
        }
    }

    #[cfg(unix)]
    fn plan_request_rejected(root: &Path, file: &str) -> bool {
        plan(root, &json!({"file":file})).is_err()
    }
}
