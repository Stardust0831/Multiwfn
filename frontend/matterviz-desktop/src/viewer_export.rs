//! Native saving for the viewer toolbar. Requests supply bytes, never a path.
use std::path::PathBuf;
use std::sync::Mutex;

static DIALOG: Mutex<()> = Mutex::new(());

pub fn validate<'a>(filename: &'a str, mime: &str, body: &[u8]) -> Result<&'a str, String> {
    if filename.is_empty()
        || filename.len() > 255
        || filename.starts_with('.')
        || filename
            .chars()
            .any(|c| c.is_control() || "\\/:*?\"<>|".contains(c))
    {
        return Err("Export must have a plain filename".into());
    }
    let extension = filename.rsplit_once('.').map(|(_, ext)| ext).unwrap_or("");
    let expected = match extension {
        "png" => "image/png",
        "pdf" => "application/pdf",
        "svg" => "image/svg+xml",
        "csv" => "text/csv",
        "json" => "application/json",
        _ => return Err("Unsupported viewer export type".into()),
    };
    if mime.split(';').next().unwrap_or("").trim() != expected
        || body.is_empty()
        || body.len() > 64 * 1024 * 1024
    {
        return Err("Invalid export type or size".into());
    }
    let valid = match extension {
        "png" => body.starts_with(b"\x89PNG\r\n\x1a\n"),
        "pdf" => body.starts_with(b"%PDF-"),
        "json" => serde_json::from_slice::<serde_json::Value>(body).is_ok(),
        _ => !body.contains(&0) && std::str::from_utf8(body).is_ok(),
    };
    if !valid {
        return Err("Export bytes do not match their type".into());
    }
    Ok(extension)
}

pub fn save(filename: &str, extension: &str, body: &[u8]) -> Result<bool, String> {
    // Keep calculation requests responsive while a save dialog is open.
    let _dialog = DIALOG
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    save_with(
        filename,
        extension,
        body,
        crate::file_dialog::save_viewer_export,
    )
}

fn save_with(
    filename: &str,
    extension: &str,
    body: &[u8],
    choose: impl FnOnce(&str, &str) -> Result<Option<PathBuf>, String>,
) -> Result<bool, String> {
    let Some(mut path) = choose(filename, extension)? else {
        return Ok(false);
    };
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case(extension))
    {
        // Native dialogs confirm replacing this exact filename before returning.
        crate::service::write_export_atomically(&path, body)?;
    } else {
        // A suffix appended after the dialog was not part of its overwrite
        // confirmation. Create exclusively, preserving any existing target.
        use std::io::Write;
        let mut name = path
            .file_name()
            .ok_or("Export path has no filename")?
            .to_os_string();
        name.push(format!(".{extension}"));
        path.set_file_name(name);
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&path)
            .map_err(|error| format!("Could not create export {}; choose the full filename to confirm replacement: {error}", path.display()))?;
        let result = file.write_all(body).and_then(|()| file.sync_all());
        drop(file);
        if let Err(error) = result {
            let _ = std::fs::remove_file(path);
            return Err(format!("Could not write export: {error}"));
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_and_overwrite_preserve_the_selected_file() {
        let dir =
            std::env::temp_dir().join(format!("matterviz-native-save-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("scene.png");
        std::fs::write(&target, b"original").unwrap();
        assert!(!save_with("scene.png", "png", b"replacement", |_, _| Ok(None)).unwrap());
        assert_eq!(std::fs::read(&target).unwrap(), b"original");
        assert!(
            save_with("scene.png", "png", b"replacement", |_, _| Ok(Some(
                dir.join("scene")
            )))
            .is_err()
        );
        assert_eq!(std::fs::read(&target).unwrap(), b"original");
        assert!(
            save_with("scene.png", "png", b"replacement", |_, _| Ok(Some(
                target.clone()
            )))
            .unwrap()
        );
        assert_eq!(std::fs::read(&target).unwrap(), b"replacement");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn validates_type_and_rejects_destination_paths() {
        let png = b"\x89PNG\r\n\x1a\nimage";
        assert_eq!(validate("scene.png", "image/png", png).unwrap(), "png");
        assert!(validate("../scene.png", "image/png", png).is_err());
        assert!(validate("C:\\scene.png", "image/png", png).is_err());
        assert!(validate("scene.png", "text/plain", png).is_err());
        assert!(validate("scene.png", "image/png", b"error").is_err());
        assert!(validate("scene.exe", "application/octet-stream", png).is_err());
    }
}
