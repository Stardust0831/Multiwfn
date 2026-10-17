use std::io;
use std::path::{Path, PathBuf};

pub fn select_file(_output: &Path) -> io::Result<Option<PathBuf>> {
    #[cfg(target_os = "linux")]
    if let Some(result) = packaged_chooser("wavefunction") {
        return result;
    }
    Ok(rfd::FileDialog::new().pick_file())
}

pub fn select_workflow_path(kind: &str) -> Result<Option<PathBuf>, String> {
    if !matches!(kind, "library" | "results" | "wavefunction" | "script") {
        return Err("Invalid workflow selection".into());
    }
    #[cfg(target_os = "linux")]
    if let Some(result) = packaged_chooser(kind) {
        return result.map_err(|e| e.to_string());
    }
    let dialog = rfd::FileDialog::new();
    match kind {
        "library" => Ok(dialog
            .set_title("Choose a workflow script folder")
            .pick_folder()),
        "results" => Ok(dialog
            .set_title("Choose a workflow results folder")
            .pick_folder()),
        "wavefunction" => Ok(dialog
            .set_title("Choose the workflow startup file")
            .pick_file()),
        "script" => Ok(dialog
            .set_title("Open workflow script")
            .add_filter("BaneWfn scripts", &["bw", "bwc"])
            .pick_file()),
        _ => Err("Invalid workflow selection".into()),
    }
}

#[cfg(target_os = "linux")]
fn packaged_chooser(kind: &str) -> Option<io::Result<Option<PathBuf>>> {
    let helper = std::env::current_exe()
        .ok()?
        .parent()?
        .join("matterviz-file-dialog");
    if !helper.is_file() {
        return None;
    }
    Some((|| {
        let output = std::process::Command::new(helper).arg(kind).output()?;
        match output.status.code() {
            Some(0) => {
                use std::os::unix::ffi::OsStringExt;
                if output.stdout.is_empty() {
                    return Err(io::Error::other("File chooser returned an empty path"));
                }
                Ok(Some(PathBuf::from(std::ffi::OsString::from_vec(
                    output.stdout,
                ))))
            }
            Some(1) => Ok(None),
            _ => Err(io::Error::other(format!(
                "Native file chooser failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ))),
        }
    })())
}
