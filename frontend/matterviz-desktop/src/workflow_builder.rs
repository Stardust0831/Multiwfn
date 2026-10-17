//! Assemble ordinary, self-contained BWC files; parsing/execution stays in BaneWfn.
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() < 128
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
}
fn variable_name(value: &str) -> bool {
    let base = value
        .strip_suffix('*')
        .or_else(|| value.strip_prefix("len(").and_then(|s| s.strip_suffix(')')))
        .unwrap_or(value);
    !base.is_empty()
        && base.len() < 128
        && base.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
}
fn line(value: &str) -> Result<&str, String> {
    if value.len() > 4096 || value.contains(['\0', '\r', '\n']) {
        return Err("Builder values must be single lines, at most 4096 bytes".into());
    }
    Ok(value)
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    line(
        value[key]
            .as_str()
            .ok_or_else(|| format!("Missing builder value: {key}"))?,
    )
}
fn conf_path(root: &Path, module: &str) -> Result<PathBuf, String> {
    if !identifier(module) || module == "citations" {
        return Err("Invalid conf module".into());
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let path = root.join(format!("{module}.conf"));
    if fs::symlink_metadata(&path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
        || !path.is_file()
        || fs::metadata(&path).map_err(|e| e.to_string())?.len() > 128 * 1024
    {
        return Err("Invalid conf file".into());
    }
    Ok(path)
}
fn sections(source: &str) -> Vec<Value> {
    let mut result = Vec::new();
    let mut notes: Vec<&str> = Vec::new();
    let mut metadata = false;
    for raw in source.lines() {
        let raw = raw.trim();
        if raw.starts_with("#@gui") {
            metadata = true;
            notes.clear();
            continue;
        }
        if raw.starts_with("#@end") {
            metadata = false;
            continue;
        }
        if metadata {
            continue;
        }
        if let Some(note) = raw.strip_prefix('#') {
            notes.push(note.trim());
            continue;
        }
        let header = raw.split('#').next().unwrap_or("").trim();
        if let Some(name) = header.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            let name = name.trim();
            if identifier(name) && !matches!(name, "quit" | "citations") {
                result.push(json!({"name": name, "notes": notes.join("\n")}));
            }
        }
        if !raw.is_empty() {
            notes.clear();
        }
    }
    result
}
pub fn catalog(root: &Path) -> Result<Value, String> {
    let mut modules = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|v| v.to_str()) != Some("conf") {
            continue;
        }
        let Some(name) = path.file_stem().and_then(|v| v.to_str()) else {
            continue;
        };
        if !identifier(name)
            || name == "citations"
            || entry.file_type().map_err(|e| e.to_string())?.is_symlink()
        {
            continue;
        }
        let source = fs::read_to_string(conf_path(root, name)?).map_err(|e| e.to_string())?;
        let entries = sections(&source);
        if entries.iter().any(|v| v["name"] == "main") {
            modules.push(json!({"name": name, "sections": entries}));
        }
        if modules.len() > 256 {
            return Err("Too many conf modules".into());
        }
    }
    modules.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    Ok(json!({"version": 1, "modules": modules}))
}

pub struct Compiled {
    pub source: String,
    pub parameter_ids: BTreeSet<String>,
}
fn parameters(
    value: &Value,
    location: &str,
    variables: &mut String,
    ids: &mut BTreeSet<String>,
) -> Result<String, String> {
    let Some(map) = value.as_object() else {
        if value.is_null() {
            return Ok(String::new());
        }
        return Err("Invalid builder parameters".into());
    };
    if map.len() > 64 {
        return Err("Too many builder parameters".into());
    }
    let mut out = String::new();
    // Sort for a reproducible saved script, independently of JSON object ordering.
    let sorted: BTreeMap<_, _> = map.iter().collect();
    for (key, value) in sorted {
        if !variable_name(key) {
            return Err("Invalid builder parameter name".into());
        }
        let value = line(value.as_str().ok_or("Invalid builder parameter value")?)?;
        ids.insert(format!("{location}/{key}"));
        if value.trim().is_empty() {
            return Err("Enter a parameter value, or reset it to the conf default".into());
        }
        let token = if value.chars().any(char::is_whitespace) {
            // Native %process uses whitespace-separated tokens. A scalar variable
            // carries literal paths/spaces without inventing another quoting grammar.
            if value.contains(['$', '#', '"']) || (value.starts_with('(') && value.ends_with(')')) {
                return Err("A parameter containing spaces must be a literal value; use a variable for expressions".into());
            }
            let name = format!("gui_value_{}", ids.len());
            variables.push_str(&format!("{name}={value}\n"));
            format!("${{{name}}}")
        } else {
            if value.contains('#') {
                return Err("Parameter values cannot contain #".into());
            }
            value.to_owned()
        };
        out.push_str(&format!(" {key} {token}"));
    }
    Ok(out)
}
fn command_body(value: &Value) -> Result<String, String> {
    let body = value.as_str().ok_or("Invalid command text")?;
    if body.len() > 32 * 1024 || body.contains('\0') || body.trim().is_empty() {
        return Err("Enter a shell command".into());
    }
    // These lines terminate/change a BaneWfn block even inside %command.
    for raw in body.lines() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if matches!(
            line,
            "end" | "wait" | "%command" | "%process" | "%raw" | "%preraw" | "%grep"
        ) || (raw.starts_with('[') && line.ends_with(']'))
            || line.contains("BANEWFN_INLINE_")
            || raw.trim().starts_with("#!")
        {
            return Err(
                "Custom commands must not contain BaneWfn block delimiters or a shebang".into(),
            );
        }
    }
    Ok(body.replace("\r\n", "\n").trim_end().to_owned())
}
fn shell_header(value: &Value) -> Result<&'static str, String> {
    match value.as_str().unwrap_or("bash") {
        "bash" => Ok("#!/bin/bash\nset -e\n"),
        "cmd" => Ok(""),
        _ => Err("Invalid command shell".into()),
    }
}
fn rename_path(value: &str) -> Result<String, String> {
    // Double quotes keep spaces together; the driver's placeholder substitution
    // occurs before the shell. No shell expansion is needed in rename fields.
    line(value)?;
    if value.trim().is_empty() || value.contains(['"', '`', '%']) || value.contains("$(") {
        return Err("Rename paths cannot contain shell expressions or quotes".into());
    }
    let mut rest = value;
    while let Some(pos) = rest.find('$') {
        let next = &rest[pos + 1..];
        let Some(next) = next.strip_prefix('{') else {
            return Err("Use ${name} for rename placeholders".into());
        };
        let Some((name, tail)) = next.split_once('}') else {
            return Err("Invalid rename placeholder".into());
        };
        if !variable_name(name) {
            return Err("Invalid rename placeholder".into());
        }
        rest = tail;
    }
    Ok(format!("\"{value}\""))
}
pub fn compile(root: &Path, draft: &Value) -> Result<Compiled, String> {
    let steps = draft["steps"].as_array().ok_or("Invalid builder steps")?;
    if steps.is_empty() || steps.len() > 64 {
        return Err("Add between 1 and 64 workflow steps".into());
    }
    let globals = draft["variables"].as_str().unwrap_or("");
    if globals.len() > 16 * 1024 {
        return Err("Too many builder variables".into());
    }
    for raw in globals.lines().filter(|s| !s.trim().is_empty()) {
        if raw.trim().starts_with('#') {
            continue;
        }
        let (key, value) = raw
            .split_once('=')
            .ok_or("Variables must use key=value, one per line")?;
        let key = key.trim();
        if !variable_name(key)
            || key.starts_with("gui_value_")
            || matches!(
                key,
                "wfn"
                    | "core"
                    | "dryrun"
                    | "debug"
                    | "nogui"
                    | "wfn_rebase"
                    | "citations_output"
                    | "input"
                    | "output"
            )
        {
            return Err(
                "Use custom variable names; startup file and cores are set in the workbench".into(),
            );
        }
        line(value)?;
    }
    let mut variables = String::new();
    let mut body = String::new();
    let mut configs = BTreeMap::new();
    let mut parameter_ids = BTreeSet::new();
    for (index, step) in steps.iter().enumerate() {
        match text(step, "kind")? {
            "analysis" => {
                let module = text(step, "module")?;
                let conf =
                    fs::read_to_string(conf_path(root, module)?).map_err(|e| e.to_string())?;
                let entries = sections(&conf);
                let processes = step["processes"]
                    .as_array()
                    .ok_or("Invalid process steps")?;
                if processes.len() > 64 {
                    return Err("Too many process sections".into());
                }
                body.push_str(&format!("[{module}]\n"));
                let params = parameters(
                    &step["parameters"],
                    &format!("{index}/main"),
                    &mut variables,
                    &mut parameter_ids,
                )?;
                // Main parameters use one key/value pair per line.
                if !params.is_empty() {
                    let tokens: Vec<_> = params.split_whitespace().collect();
                    for pair in tokens.chunks_exact(2) {
                        body.push_str(&format!("{} {}\n", pair[0], pair[1]));
                    }
                }
                if !processes.is_empty() {
                    body.push_str("%process\n");
                }
                for (position, process) in processes.iter().enumerate() {
                    let section = text(process, "section")?;
                    if section == "main" || !entries.iter().any(|v| v["name"] == section) {
                        return Err("Select a process section from the conf list".into());
                    }
                    let params = parameters(
                        &process["parameters"],
                        &format!("{index}/{position}"),
                        &mut variables,
                        &mut parameter_ids,
                    )?;
                    body.push_str(&format!("  {section}{params}\n"));
                }
                let commands = step["commands"]
                    .as_array()
                    .ok_or("Invalid post-processing commands")?;
                if commands.len() > 64 {
                    return Err("Too many post-processing commands".into());
                }
                if !commands.is_empty() {
                    let header = shell_header(&step["shell"])?;
                    body.push_str("%command\n");
                    body.push_str(header);
                    for command in commands {
                        match text(command, "kind")? {
                            "rename" => {
                                let source = rename_path(text(command, "source")?)?;
                                let target = rename_path(text(command, "target")?)?;
                                if header.is_empty() {
                                    body.push_str(&format!(
                                        "move /Y {source} {target}\nif errorlevel 1 exit /b 1\n"
                                    ));
                                } else {
                                    body.push_str(&format!("mv -- {source} {target}\n"));
                                }
                            }
                            "command" => {
                                body.push_str(&command_body(&command["text"])?);
                                body.push('\n');
                            }
                            _ => return Err("Invalid post-processing command".into()),
                        }
                    }
                }
                body.push_str("end\n\n");
                configs.insert(module.to_owned(), conf);
            }
            "collect" => {
                let target = text(step, "target")?;
                if target.trim().is_empty() || target.contains(['(', ')', ';', '#']) {
                    return Err(
                        "Enter a collection folder without parentheses, semicolons or #".into(),
                    );
                }
                body.push_str(&format!("collect({target});\n\n"));
            }
            "rebase" => {
                let target = text(step, "target")?;
                if target.contains('#') {
                    return Err("Input file templates cannot contain #".into());
                }
                body.push_str(&format!("wfn_rebase={target}\n\n"));
            }
            "command" => {
                body.push_str("%command\n");
                body.push_str(shell_header(&step["shell"])?);
                body.push_str(&command_body(&step["text"])?);
                body.push_str("\nend\n\n");
            }
            _ => return Err("Invalid workflow step".into()),
        }
    }
    let mut source = format!("# Generated with BaneWfn GUI\n{globals}\n{variables}\n{body}");
    for (module, conf) in &configs {
        source.push_str(&format!("#>>> BANEWFN_INLINE_CONF_BEGIN {module}\n"));
        for raw in conf.lines() {
            source.push_str("# ");
            source.push_str(raw);
            source.push('\n');
        }
        source.push_str(&format!("#<<< BANEWFN_INLINE_CONF_END {module}\n\n"));
    }
    let citations = root.join("citations.conf");
    if !configs.is_empty() && citations.is_file() {
        let conf = fs::read_to_string(&citations).map_err(|e| e.to_string())?;
        if conf.len() > 128 * 1024 {
            return Err("Citation catalog is too large".into());
        }
        source.push_str("#>>> BANEWFN_INLINE_CITATIONS_BEGIN\n");
        for raw in conf.lines() {
            source.push_str("# ");
            source.push_str(raw);
            source.push('\n');
        }
        source.push_str("#<<< BANEWFN_INLINE_CITATIONS_END\n");
    }
    if source.len() > 512 * 1024 {
        return Err("Workflow script exceeds 512 KiB".into());
    }
    Ok(Compiled {
        source,
        parameter_ids,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "bwc-builder-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            fs::write(root.join("grid.conf"), "[main]\n5\n# density.cub\n[electron]\n1\n${grid:-3}\n# totesp.cub\n# ESP must be last\n[esp]\n12\n${grid:-1}\n[quit]\nq\n[citations]\na @main\n").unwrap();
            fs::write(root.join("citations.conf"), "[citation a]\ntitle=Example\n").unwrap();
            Self(root)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn analysis() -> Value {
        json!({"kind":"analysis","module":"grid","parameters":{},"processes":[{"section":"electron","parameters":{}},{"section":"esp","parameters":{"grid":"2"}}],"shell":"bash","commands":[{"kind":"rename","source":"totesp.cub","target":"${input}_kcal_esp.cub"}]})
    }
    #[test]
    fn catalog_excludes_reserved_sections_and_retains_order_and_comments() {
        let fixture = Fixture::new();
        let value = catalog(&fixture.0).unwrap();
        assert_eq!(value["modules"].as_array().unwrap().len(), 1);
        assert_eq!(
            value["modules"][0]["sections"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| s["name"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["main", "electron", "esp"]
        );
        assert!(value["modules"][0]["sections"][2]["notes"]
            .as_str()
            .unwrap()
            .contains("must be last"));
    }
    #[test]
    fn generated_bwc_keeps_glue_order_conf_metadata_citations_and_vcube_suffix() {
        let fixture = Fixture::new();
        let draft = json!({"variables":"state=(1 2)","steps":[analysis(),{"kind":"rebase","target":"${input}_NTO${state}.fch"},analysis(),{"kind":"rebase","target":""},{"kind":"collect","target":"${input}_ESP"}]});
        let compiled = compile(&fixture.0, &draft).unwrap();
        assert!(compiled.source.contains("[grid]\n%process\n  electron\n  esp grid 2\n%command\n#!/bin/bash\nset -e\nmv -- \"totesp.cub\" \"${input}_kcal_esp.cub\"\nend\n\nwfn_rebase=${input}_NTO${state}.fch"));
        assert!(compiled
            .source
            .contains("wfn_rebase=\n\ncollect(${input}_ESP);"));
        assert_eq!(
            compiled
                .source
                .matches("BANEWFN_INLINE_CONF_BEGIN grid")
                .count(),
            1
        );
        assert!(compiled.source.contains("# [citations]\n# a @main"));
        assert!(compiled.source.contains("BANEWFN_INLINE_CITATIONS_BEGIN"));
        assert_eq!(
            compiled.parameter_ids,
            BTreeSet::from(["0/1/grid".into(), "2/1/grid".into()])
        );
        assert!(!compiled.source.contains("wfn="));
    }
    #[test]
    fn literal_paths_use_native_scalar_variables_and_cmd_is_explicit() {
        let fixture = Fixture::new();
        let mut step = analysis();
        step["parameters"] = json!({"logfile":"C:\\计算 files\\sample.log"});
        step["shell"] = json!("cmd");
        let compiled = compile(&fixture.0, &json!({"steps":[step]})).unwrap();
        assert!(compiled
            .source
            .contains("gui_value_1=C:\\计算 files\\sample.log\n"));
        assert!(compiled.source.contains("logfile ${gui_value_1}\n"));
        assert!(compiled.source.contains(
            "move /Y \"totesp.cub\" \"${input}_kcal_esp.cub\"\nif errorlevel 1 exit /b 1"
        ));
        assert!(!compiled.source.contains("#!/bin/bash"));
    }
    #[test]
    fn rejects_boundary_breaking_commands_missing_sections_and_path_traversal() {
        let fixture = Fixture::new();
        for command in [
            "echo hi\nend # closes block",
            "wait",
            "%raw",
            "[grid]",
            "#!/bin/bash\necho hi",
        ] {
            assert!(
                compile(
                    &fixture.0,
                    &json!({"steps":[{"kind":"command","shell":"bash","text":command}]})
                )
                .is_err(),
                "{command}"
            );
        }
        let mut step = analysis();
        step["processes"][0]["section"] = json!("quit");
        assert!(compile(&fixture.0, &json!({"steps":[step]})).is_err());
        let mut step = analysis();
        step["module"] = json!("../grid");
        assert!(compile(&fixture.0, &json!({"steps":[step]})).is_err());
        for path in ["$(touch file)", "${bad", "%TEMP%", "file\nend", "\"file\""] {
            assert!(rename_path(path).is_err());
        }
    }
}
