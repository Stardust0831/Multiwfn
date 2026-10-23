//! Bounded native viewer exports. Browser requests never contain a destination path.
use std::path::{Path, PathBuf};
pub const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;
#[derive(Debug, PartialEq)]
pub enum SaveOutcome {
    Saved,
    Cancelled,
}

pub fn export_metadata<'a>(filename: &'a str, mime: &str) -> Result<(&'a str, usize), String> {
    if filename.is_empty()
        || filename.len() > 128
        || filename.starts_with('.')
        || filename.ends_with(['.', ' '])
        || filename.contains("..")
        || !filename
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_. ".contains(&b))
    {
        return Err("Invalid export filename: use a plain filename, not a path".into());
    }
    let stem = filename
        .split('.')
        .next()
        .unwrap_or("")
        .to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
    {
        return Err("Reserved export filename".into());
    }
    let extension = filename.rsplit_once('.').map(|(_, ext)| ext).unwrap_or("");
    let (expected, limit) = match extension {
        "png" => ("image/png", 32 * 1024 * 1024),
        "webm" => ("video/webm", MAX_EXPORT_BYTES),
        "glb" => ("model/gltf-binary", MAX_EXPORT_BYTES),
        "json" => ("application/json", 16 * 1024 * 1024),
        "cif" => ("chemical/x-cif", 16 * 1024 * 1024),
        "xyz" | "poscar" | "obj" | "mtl" => ("text/plain", 16 * 1024 * 1024),
        _ => return Err("Unsupported viewer export type".into()),
    };
    if mime != expected {
        return Err("Export type does not match its filename".into());
    }
    Ok((extension, limit))
}

pub fn validate_export<'a>(filename: &'a str, mime: &str, body: &[u8]) -> Result<&'a str, String> {
    let (extension, limit) = export_metadata(filename, mime)?;
    if body.is_empty() || body.len() > limit {
        return Err("Export byte limit does not match its filename".into());
    }
    let valid = match extension {
        "png" => png_matches(body),
        "webm" => webm_matches(body),
        "glb" => glb_matches(body),
        "json" => serde_json::from_slice::<serde_json::Value>(body).is_ok(),
        _ => !body.contains(&0) && std::str::from_utf8(body).is_ok(),
    };
    if !valid {
        return Err("Export bytes do not match the declared type".into());
    }
    Ok(extension)
}
// Validate bounded container framing without decoding or running any payload.
fn png_matches(body: &[u8]) -> bool {
    if !body.starts_with(b"\x89PNG\r\n\x1a\n") {
        return false;
    }
    let mut offset = 8;
    let mut image_data = false;
    while offset + 12 <= body.len() {
        let length = u32::from_be_bytes(body[offset..offset + 4].try_into().unwrap()) as usize;
        let Some(end) = offset.checked_add(12).and_then(|v| v.checked_add(length)) else {
            return false;
        };
        if end > body.len() {
            return false;
        }
        let kind = &body[offset + 4..offset + 8];
        if offset == 8 {
            if kind != b"IHDR" || length != 13 {
                return false;
            }
            let width = u32::from_be_bytes(body[offset + 8..offset + 12].try_into().unwrap());
            let height = u32::from_be_bytes(body[offset + 12..offset + 16].try_into().unwrap());
            if width == 0 || height == 0 || width > 32768 || height > 32768 {
                return false;
            }
        } else if kind == b"IHDR" {
            return false;
        }
        if kind == b"IDAT" && length > 0 {
            image_data = true;
        }
        if kind == b"IEND" {
            return length == 0 && end == body.len() && image_data;
        }
        offset = end;
    }
    false
}
fn vint(body: &[u8]) -> Option<(u64, usize)> {
    let first = *body.first()?;
    let size = first.leading_zeros() as usize + 1;
    if size > 8 || body.len() < size {
        return None;
    }
    let mut value = u64::from(first) & (0xff_u64 >> size);
    for byte in &body[1..size] {
        value = (value << 8) | u64::from(*byte);
    }
    Some((value, size))
}
fn webm_matches(body: &[u8]) -> bool {
    if !body.starts_with(b"\x1a\x45\xdf\xa3") {
        return false;
    }
    let Some((length, size)) = vint(&body[4..]) else {
        return false;
    };
    let header_end = 4 + size + length as usize;
    if header_end > 4096 || header_end + 5 > body.len() {
        return false;
    }
    if !body[4 + size..header_end]
        .windows(7)
        .any(|w| w == b"\x42\x82\x84webm")
        || &body[header_end..header_end + 4] != b"\x18\x53\x80\x67"
    {
        return false;
    }
    let segment = &body[header_end + 4..];
    let Some((length, size)) = vint(segment) else {
        return false;
    };
    let unknown = (1_u64 << (7 * size)) - 1;
    segment.len() > size && (length == unknown || length == (segment.len() - size) as u64)
}
fn glb_matches(body: &[u8]) -> bool {
    if body.len() < 20
        || !body.starts_with(b"glTF\x02\0\0\0")
        || u32::from_le_bytes(body[8..12].try_into().unwrap()) as usize != body.len()
    {
        return false;
    }
    let mut offset = 12;
    let mut chunks = 0;
    while offset + 8 <= body.len() {
        let length = u32::from_le_bytes(body[offset..offset + 4].try_into().unwrap()) as usize;
        let Some(end) = offset.checked_add(8).and_then(|v| v.checked_add(length)) else {
            return false;
        };
        if length % 4 != 0 || end > body.len() {
            return false;
        }
        let kind = &body[offset + 4..offset + 8];
        if chunks == 0 {
            if kind != b"JSON"
                || serde_json::from_slice::<serde_json::Value>(&body[offset + 8..end]).is_err()
            {
                return false;
            }
        } else if chunks != 1 || kind != b"BIN\0" {
            return false;
        }
        chunks += 1;
        offset = end;
    }
    chunks > 0 && offset == body.len()
}

pub fn save_with(
    filename: &str,
    mime: &str,
    body: &[u8],
    choose: impl FnOnce(&str, &str) -> Result<Option<PathBuf>, String>,
    write: impl FnOnce(&Path, &[u8]) -> Result<(), String>,
) -> Result<SaveOutcome, String> {
    let extension = validate_export(filename, mime, body)?;
    let Some(path) = choose(filename, extension)? else {
        return Ok(SaveOutcome::Cancelled);
    };
    write(&path, body)?;
    Ok(SaveOutcome::Saved)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    pub(crate) const PNG: &[u8] = b"\x89\x50\x4e\x47\x0d\x0a\x1a\x0a\x00\x00\x00\x0d\x49\x48\x44\x52\x00\x00\x00\x01\x00\x00\x00\x01\x08\x04\x00\x00\x00\xb5\x1c\x0c\x02\x00\x00\x00\x0b\x49\x44\x41\x54\x78\xda\x63\xfc\xff\x1f\x00\x03\x03\x02\x00\xee\x85\xff\x99\x00\x00\x00\x00\x49\x45\x4e\x44\xae\x42\x60\x82";
    #[test]
    fn validates_types_signatures_and_limits_before_dialog() {
        for (name, mime, body) in [
            ("water.png", "image/png", PNG),
            ("water.webm", "video/webm", b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\xf7\x81\x01\x42\xf2\x81\x04\x42\xf3\x81\x08\x42\x82\x84webm\x42\x87\x81\x04\x42\x85\x81\x02\x18\x53\x80\x67\x01\xff\xff\xff\xff\xff\xff\xff\x15\x49\xa9\x66".as_slice()),
            ("water.glb", "model/gltf-binary", b"glTF\x02\0\0\0\x18\0\0\0\x04\0\0\0JSON{}  ".as_slice()),
            ("water.json", "application/json", b"{\"sites\":[]}".as_slice()),
            ("water.xyz", "text/plain", b"1\nframe\nH 0 0 0\n".as_slice()),
            ("water.cif", "chemical/x-cif", b"data_water\n".as_slice()),
            ("water.poscar", "text/plain", b"water\n".as_slice()),
            ("water.obj", "text/plain", b"mtllib water.mtl\n".as_slice()),
            ("water.mtl", "text/plain", b"newmtl red\n".as_slice()),
        ] { assert!(validate_export(name, mime, body).is_ok(), "{name}"); }
        for (name, mime, body) in [
            ("water.png", "text/plain", PNG),
            ("water.png", "image/png", &PNG[..8]),
            (
                "water.webm",
                "video/webm",
                b"\x1a\x45\xdf\xa3\x42\x82\x84webm".as_slice(),
            ),
            (
                "water.glb",
                "model/gltf-binary",
                b"glTF\x02\0\0\0\x0c\0\0\0".as_slice(),
            ),
            ("water.png", "image/png", b"not png".as_slice()),
            (
                "water.webm",
                "video/webm",
                b"\x1a\x45\xdf\xa3matroska".as_slice(),
            ),
            ("water.glb", "model/gltf-binary", b"glTF".as_slice()),
            ("water.json", "application/json", b"not json".as_slice()),
            ("water.xyz", "text/plain", b"a\0b".as_slice()),
            ("water.xyz", "text/plain", b"".as_slice()),
        ] {
            assert!(validate_export(name, mime, body).is_err(), "{name}");
        }
        assert!(validate_export("x.webm", "video/webm", &vec![0; MAX_EXPORT_BYTES + 1]).is_err());
    }
    #[test]
    fn rejects_paths_reserved_names_and_unsupported_suffixes() {
        for name in [
            "../x.png",
            "/x.png",
            "C:\\x.png",
            "x/y.png",
            "x\\y.png",
            ".hidden.png",
            "x.png ",
            "x.png.",
            "CON.png",
            "com1.png",
            "x:evil.png",
            "x\n.png",
            "x.mp4",
            "x.exe",
            "x.PNG",
            "x\0.png",
        ] {
            assert!(validate_export(name, "image/png", PNG).is_err(), "{name:?}");
        }
        assert!(validate_export(&format!("{}.png", "a".repeat(160)), "image/png", PNG).is_err());
    }
    #[test]
    fn only_dialog_selected_path_is_written_and_cancellation_is_distinct() {
        let chosen = PathBuf::from("/dialog/selected/water.png");
        let outcome = save_with(
            "water.png",
            "image/png",
            PNG,
            |name, ext| {
                assert_eq!(name, "water.png");
                assert_eq!(ext, "png");
                Ok(Some(chosen.clone()))
            },
            |path, bytes| {
                assert_eq!(path, chosen);
                assert_eq!(bytes, PNG);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(outcome, SaveOutcome::Saved);
        assert_eq!(
            save_with(
                "water.png",
                "image/png",
                PNG,
                |_, _| Ok(None),
                |_, _| panic!("cancel must not write")
            )
            .unwrap(),
            SaveOutcome::Cancelled
        );
        assert!(save_with(
            "../bad.png",
            "image/png",
            PNG,
            |_, _| panic!("invalid must not open chooser"),
            |_, _| panic!()
        )
        .is_err());
    }
    #[test]
    fn real_writes_use_only_the_selected_file_and_io_failures_do_not_succeed() {
        let root = std::env::temp_dir().join(format!("viewer-export-io-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let selected = root.join("chosen.png");
        let result = save_with(
            "suggestion.png",
            "image/png",
            PNG,
            |_, _| Ok(Some(selected.clone())),
            |path, bytes| std::fs::write(path, bytes).map_err(|e| e.to_string()),
        );
        assert_eq!(result.unwrap(), SaveOutcome::Saved);
        assert_eq!(std::fs::read(&selected).unwrap(), PNG);
        assert!(!root.join("suggestion.png").exists());
        let missing = root.join("not-selected-parent").join("out.png");
        let result = save_with(
            "suggestion.png",
            "image/png",
            PNG,
            |_, _| Ok(Some(missing)),
            |path, bytes| std::fs::write(path, bytes).map_err(|e| e.to_string()),
        );
        assert!(result.is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn chooser_and_write_failure_never_report_saved() {
        let result = save_with(
            "water.png",
            "image/png",
            PNG,
            |_, _| Err("chooser failed".into()),
            |_, _| panic!(),
        );
        assert_eq!(result, Err("chooser failed".into()));
        let result = save_with(
            "water.png",
            "image/png",
            PNG,
            |_, _| Ok(Some(PathBuf::from("/selected"))),
            |_, _| Err("write failed".into()),
        );
        assert_eq!(result, Err("write failed".into()));
    }
}
