//! Secure, deliberately small updater protocol used by the MatterViz desktop shell.
//!
//! The library keeps all security-sensitive decisions independent of the CLI.  The
//! network layer is injectable, which makes signature, archive and transaction
//! tests deterministic and avoids making the frontend trust arbitrary URLs.

#![deny(unsafe_code)]

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use ed25519_dalek::pkcs8::DecodePrivateKey;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{Display, Formatter};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use zeroize::Zeroizing;

#[cfg(test)]
use std::cell::Cell;

#[cfg(test)]
thread_local! { static INJECT_FAILURE_AFTER_RENAME: Cell<bool> = const { Cell::new(false) }; }

pub const REPOSITORY: &str = "Stardust0831/Multiwfn";
pub const CHANNEL: &str = "preview";
pub const MAX_ENTRIES: usize = 20_000;
pub const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_EXTRACTED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_JSON_BYTES: usize = 64 * 1024;
pub const MAX_JOURNAL_BYTES: usize = 16 * 1024 * 1024;
pub const INSTALL_MANIFEST_NAME: &str = ".multiwfn-install-manifest-v1.json";
pub const INSTALL_PROOF_NAME: &str = ".multiwfn-install-proof-v1.json";
pub const RELEASE_MANIFEST_ASSET_NAME: &str = "multiwfn-matterviz-release-manifest-v1.json";
pub const MAX_MESSAGE_BYTES: usize = 1024;

#[derive(Debug)]
pub enum Error {
    Io(io::Error),
    Json(serde_json::Error),
    Invalid(String),
    Signature(String),
    Network(String),
    Conflict(String),
    Limit(String),
}

impl Display for Error {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "I/O error: {e}"),
            Self::Json(e) => write!(f, "JSON error: {e}"),
            Self::Invalid(s) => write!(f, "invalid input: {s}"),
            Self::Signature(s) => write!(f, "signature verification failed: {s}"),
            Self::Network(s) => write!(f, "network error: {s}"),
            Self::Conflict(s) => write!(f, "update conflict: {s}"),
            Self::Limit(s) => write!(f, "limit exceeded: {s}"),
        }
    }
}
impl std::error::Error for Error {}
impl From<io::Error> for Error { fn from(e: io::Error) -> Self { Self::Io(e) } }
impl From<serde_json::Error> for Error { fn from(e: serde_json::Error) -> Self { Self::Json(e) } }
impl From<zip::result::ZipError> for Error { fn from(e: zip::result::ZipError) -> Self { Self::Invalid(e.to_string()) } }

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FilePolicy { Managed, Preserve }

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct InstallFile {
    pub path: String,
    pub size: u64,
    pub sha256: String,
    #[serde(default)]
    pub executable: bool,
    pub policy: FilePolicy,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct InstallManifestV1 {
    pub version: u32,
    pub target: String,
    pub release_tag: String,
    pub files: Vec<InstallFile>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ReleaseTarget {
    pub target: String,
    pub archive_name: String,
    pub archive_size: u64,
    pub archive_sha256: String,
    pub install_manifest_sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ReleaseManifestV1 {
    pub version: u32,
    pub repository: String,
    pub tag: String,
    pub channel: String,
    pub targets: Vec<ReleaseTarget>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SignedReleaseManifest {
    pub manifest: ReleaseManifestV1,
    pub key_id: String,
    pub signature: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct InstalledInventoryProof {
    pub version: u32,
    pub repository: String,
    pub channel: String,
    pub release_tag: String,
    pub target: String,
    pub install_manifest_sha256: String,
    pub key_id: String,
    pub signature: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
struct InstalledInventoryPayload<'a> {
    version: u32,
    repository: &'a str,
    channel: &'a str,
    release_tag: &'a str,
    target: &'a str,
    install_manifest_sha256: &'a str,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PublicKeyEntry {
    pub version: u32,
    pub key_id: String,
    pub public_key: String,
}

/// Production intentionally has no trusted key until a maintainer adds one.
/// Keeping this empty is fail-closed and prevents an unsigned release from
/// becoming trusted merely because the updater was shipped.
pub const EMBEDDED_PUBLIC_KEYS_JSON: &str = include_str!("../trusted-keys.json");

pub fn embedded_key_registry() -> Result<Vec<PublicKeyEntry>> {
    let source = option_env!("MULTIWFN_UPDATER_TRUSTED_KEYS_JSON").unwrap_or(EMBEDDED_PUBLIC_KEYS_JSON);
    let keys: Vec<PublicKeyEntry> = serde_json::from_str(source)?;
    if keys.is_empty() { return Err(Error::Signature("trusted key registry is empty".into())); }
    Ok(keys)
}

pub fn parse_preview_tag(tag: &str) -> Option<u64> {
    let n = tag.strip_prefix("matterviz-preview-")?;
    if n.is_empty() || !n.bytes().all(|b| b.is_ascii_digit()) { return None; }
    let value = n.parse::<u64>().ok()?;
    (value > 0).then_some(value)
}

/// Compatibility aliases used by release tooling and integration tests.
pub fn parse_tag(tag: &str) -> Option<u64> { parse_preview_tag(tag) }

pub fn is_newer_preview(candidate: &str, current: Option<&str>) -> bool {
    let Some(c) = parse_preview_tag(candidate) else { return false };
    match current.and_then(parse_preview_tag) { Some(v) => c > v, None => true }
}

fn canonical_json<T: Serialize>(value: &T) -> Result<Vec<u8>> { Ok(serde_json::to_vec(value)?) }

pub fn sign_manifest(manifest: &ReleaseManifestV1, key_id: &str, pkcs8_base64: &str) -> Result<SignedReleaseManifest> {
    validate_release_manifest(manifest)?;
    if key_id.trim().is_empty() { return Err(Error::Invalid("empty key id".into())); }
    let text = Zeroizing::new(pkcs8_base64.trim().to_owned());
    let der = Zeroizing::new(B64.decode(text.as_bytes()).map_err(|e| Error::Invalid(format!("private key base64: {e}")))?);
    let signing = SigningKey::from_pkcs8_der(&der).map_err(|e| Error::Invalid(format!("PKCS#8 private key: {e}")))?;
    let sig = signing.sign(&canonical_json(manifest)?);
    Ok(SignedReleaseManifest { manifest: manifest.clone(), key_id: key_id.to_owned(), signature: B64.encode(sig.to_bytes()) })
}
pub fn build_signed_manifest(manifest: &ReleaseManifestV1, key_id: &str, pkcs8_base64: &str) -> Result<SignedReleaseManifest> { sign_manifest(manifest, key_id, pkcs8_base64) }

pub fn verify_signed_manifest(signed: &SignedReleaseManifest, registry: &[PublicKeyEntry]) -> Result<()> {
    validate_release_manifest(&signed.manifest)?;
    let entry = registry.iter().find(|e| e.version == 1 && e.key_id == signed.key_id)
        .ok_or_else(|| Error::Signature(format!("unknown key id {}", signed.key_id)))?;
    let key_bytes = B64.decode(entry.public_key.as_bytes()).map_err(|e| Error::Signature(format!("public key encoding: {e}")))?;
    let key_array: [u8; 32] = key_bytes.try_into().map_err(|_| Error::Signature("public key must be 32 bytes".into()))?;
    let key = VerifyingKey::from_bytes(&key_array).map_err(|e| Error::Signature(e.to_string()))?;
    let sig_bytes = B64.decode(signed.signature.as_bytes()).map_err(|e| Error::Signature(format!("signature encoding: {e}")))?;
    let sig = Signature::from_slice(&sig_bytes).map_err(|e| Error::Signature(e.to_string()))?;
    key.verify(&canonical_json(&signed.manifest)?, &sig).map_err(|e| Error::Signature(e.to_string()))
}
pub fn verify_release_manifest(signed: &SignedReleaseManifest, registry: &[PublicKeyEntry]) -> Result<()> { verify_signed_manifest(signed, registry) }

fn proof_payload(proof: &InstalledInventoryProof) -> InstalledInventoryPayload<'_> {
    InstalledInventoryPayload { version: proof.version, repository: &proof.repository, channel: &proof.channel, release_tag: &proof.release_tag, target: &proof.target, install_manifest_sha256: &proof.install_manifest_sha256 }
}

pub fn sign_inventory_proof(manifest: &InstallManifestV1, key_id: &str, pkcs8_base64: &str) -> Result<InstalledInventoryProof> {
    validate_install_manifest(manifest)?;
    let text = Zeroizing::new(pkcs8_base64.trim().to_owned());
    let der = Zeroizing::new(B64.decode(text.as_bytes()).map_err(|e| Error::Invalid(format!("private key base64: {e}")))?);
    let signing = SigningKey::from_pkcs8_der(&der).map_err(|e| Error::Invalid(format!("PKCS#8 private key: {e}")))?;
    let mut proof = InstalledInventoryProof { version: 1, repository: REPOSITORY.into(), channel: CHANNEL.into(), release_tag: manifest.release_tag.clone(), target: manifest.target.clone(), install_manifest_sha256: manifest_sha256(manifest)?, key_id: key_id.into(), signature: String::new() };
    proof.signature = B64.encode(signing.sign(&canonical_json(&proof_payload(&proof))?).to_bytes());
    Ok(proof)
}

pub fn verify_inventory_proof(proof: &InstalledInventoryProof, registry: &[PublicKeyEntry]) -> Result<()> {
    validate_inventory_proof_metadata(proof)?;
    validate_digest(&proof.install_manifest_sha256)?;
    let entry = registry.iter().find(|e| e.version == 1 && e.key_id == proof.key_id).ok_or_else(|| Error::Signature(format!("unknown proof key {}", proof.key_id)))?;
    let bytes = B64.decode(entry.public_key.as_bytes()).map_err(|e| Error::Signature(e.to_string()))?;
    let key_array: [u8; 32] = bytes.try_into().map_err(|_| Error::Signature("proof public key length".into()))?;
    let key = VerifyingKey::from_bytes(&key_array).map_err(|e| Error::Signature(e.to_string()))?;
    let sig = Signature::from_slice(&B64.decode(proof.signature.as_bytes()).map_err(|e| Error::Signature(e.to_string()))?).map_err(|e| Error::Signature(e.to_string()))?;
    key.verify(&canonical_json(&proof_payload(proof))?, &sig).map_err(|e| Error::Signature(e.to_string()))
}

fn validate_inventory_proof_metadata(proof: &InstalledInventoryProof) -> Result<()> {
    if proof.version != 1 || proof.repository != REPOSITORY || proof.channel != CHANNEL || proof.target.trim().is_empty() || parse_preview_tag(&proof.release_tag).is_none() { return Err(Error::Signature("invalid installed proof metadata".into())); }
    validate_digest(&proof.install_manifest_sha256)
}

pub fn read_inventory_proof(root: &Path) -> Result<InstalledInventoryProof> {
    let bytes = fs::read(root.join(INSTALL_PROOF_NAME))?;
    if bytes.len() > MAX_JSON_BYTES { return Err(Error::Limit("inventory proof exceeds 64 KiB".into())); }
    let proof: InstalledInventoryProof = serde_json::from_slice(&bytes)?;
    validate_inventory_proof_metadata(&proof)?;
    Ok(proof)
}

fn validate_release_manifest(m: &ReleaseManifestV1) -> Result<()> {
    if m.version != 1 { return Err(Error::Invalid("unsupported release manifest version".into())); }
    if m.repository != REPOSITORY { return Err(Error::Invalid("manifest repository mismatch".into())); }
    if m.channel != CHANNEL || parse_preview_tag(&m.tag).is_none() { return Err(Error::Invalid("manifest is not a MatterViz preview".into())); }
    if m.targets.is_empty() || m.targets.len() > 64 { return Err(Error::Invalid("invalid target count".into())); }
    let mut targets = BTreeSet::new();
    for t in &m.targets {
        if t.target.trim().is_empty() || !targets.insert(t.target.clone()) { return Err(Error::Invalid("duplicate target".into())); }
        if t.archive_name.is_empty()
            || !t.archive_name.is_ascii()
            || t.archive_name.bytes().any(|byte| !(0x21..=0x7e).contains(&byte) || matches!(byte, b'/' | b'\\' | b':'))
            || Path::new(&t.archive_name).components().count() != 1
        {
            return Err(Error::Invalid("archive name must be a printable ASCII basename".into()));
        }
        if t.archive_size > MAX_ARCHIVE_BYTES { return Err(Error::Limit("archive exceeds 512 MiB".into())); }
        for digest in [&t.archive_sha256, &t.install_manifest_sha256] {
            if digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) { return Err(Error::Invalid("digest must be lowercase hexadecimal".into())); }
        }
    }
    Ok(())
}

pub fn manifest_bytes(manifest: &InstallManifestV1) -> Result<Vec<u8>> { canonical_json(manifest) }
pub fn manifest_sha256(manifest: &InstallManifestV1) -> Result<String> { Ok(sha256_hex(&manifest_bytes(manifest)?)) }
pub fn managed_manifest_sha256(manifest: &InstallManifestV1) -> Result<String> {
    let mut managed = manifest.clone();
    managed.files.retain(|f| f.policy == FilePolicy::Managed);
    manifest_sha256(&managed)
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn validate_digest(digest: &str) -> Result<()> {
    if digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) { return Err(Error::Invalid("invalid SHA-256 digest".into())); }
    Ok(())
}

fn validate_rel_path(path: &str) -> Result<()> {
    if path.is_empty()
        || !path.is_ascii()
        || path.bytes().any(|byte| !(0x20..=0x7e).contains(&byte))
        || path.contains('\\')
        || path.contains(':')
        || path.starts_with('/')
    {
        return Err(Error::Invalid(format!("unsafe path {path:?}")));
    }
    let p = Path::new(path);
    let mut count = 0;
    for c in p.components() {
        match c {
            Component::Normal(v) => {
                let s = v.to_string_lossy();
                if s.is_empty() || s == "." || s.ends_with(' ') || s.ends_with('.') || is_reserved_windows_name(&s) { return Err(Error::Invalid(format!("unsafe path {path:?}"))); }
                count += 1;
            }
            _ => return Err(Error::Invalid(format!("unsafe path {path:?}"))),
        }
    }
    if count == 0 { return Err(Error::Invalid(format!("unsafe path {path:?}"))); }
    Ok(())
}

fn is_reserved_windows_name(name: &str) -> bool {
    let stem = name.rsplit('/').next().unwrap_or(name).split('.').next().unwrap_or(name).to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") ||
        (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && stem.as_bytes()[3].is_ascii_digit())
}

pub fn validate_install_manifest(m: &InstallManifestV1) -> Result<()> {
    if m.version != 1 { return Err(Error::Invalid("unsupported install manifest version".into())); }
    if parse_preview_tag(&m.release_tag).is_none() || m.target.trim().is_empty() { return Err(Error::Invalid("invalid install manifest release/target".into())); }
    if m.files.len() > MAX_ENTRIES { return Err(Error::Limit("too many files".into())); }
    let mut seen = BTreeSet::new();
    let mut folded = BTreeSet::new();
    for f in &m.files {
        validate_rel_path(&f.path)?;
        validate_digest(&f.sha256)?;
        if f.path == INSTALL_MANIFEST_NAME || f.path == INSTALL_PROOF_NAME {
            return Err(Error::Invalid("updater metadata cannot be listed in inventory".into()));
        }
        if f.path == "settings.ini" && f.policy != FilePolicy::Preserve { return Err(Error::Invalid("settings.ini must be preserve".into())); }
        if f.policy == FilePolicy::Preserve && f.path != "settings.ini" { return Err(Error::Invalid("only settings.ini may be preserve".into())); }
        if !seen.insert(f.path.clone()) { return Err(Error::Invalid(format!("duplicate path {}", f.path))); }
        let key = f.path.to_ascii_lowercase();
        if !folded.insert(key) { return Err(Error::Invalid(format!("casefold collision {}", f.path))); }
    }
    Ok(())
}

pub fn read_install_manifest(root: &Path) -> Result<InstallManifestV1> {
    let bytes = fs::read(root.join(INSTALL_MANIFEST_NAME))?;
    if bytes.len() > MAX_JSON_BYTES { return Err(Error::Limit("install manifest exceeds 64 KiB".into())); }
    let m: InstallManifestV1 = serde_json::from_slice(&bytes)?;
    validate_install_manifest(&m)?;
    Ok(m)
}

pub fn write_install_manifest(root: &Path, manifest: &InstallManifestV1) -> Result<()> {
    validate_install_manifest(manifest)?;
    let bytes = canonical_json(manifest)?;
    let path = root.join(INSTALL_MANIFEST_NAME);
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, bytes)?;
    durable_replace(&temp, &path)?;
    if let Some(parent) = path.parent() { sync_directory(parent)?; }
    Ok(())
}

fn path_for(root: &Path, rel: &str) -> PathBuf {
    rel.split('/').fold(root.to_path_buf(), |p, c| p.join(c))
}

#[cfg(windows)]
#[allow(unsafe_code)]
fn windows_number_of_links(path: &Path) -> Result<u32> {
    use std::mem::MaybeUninit;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };

    let file = File::open(path)?;
    let mut info = MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::zeroed();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, info.as_mut_ptr()) } == 0 {
        return Err(Error::Io(io::Error::last_os_error()));
    }
    Ok(unsafe { info.assume_init() }.nNumberOfLinks)
}

fn check_regular_file(path: &Path) -> Result<fs::Metadata> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file() { return Err(Error::Invalid(format!("not a regular file: {}", path.display()))); }
    #[cfg(unix)] {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() > 1 { return Err(Error::Invalid(format!("hard link rejected: {}", path.display()))); }
    }
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        // FILE_ATTRIBUTE_REPARSE_POINT includes symlinks, junctions and other
        // redirecting filesystem objects. They are never followed by a
        // transaction.
        if metadata.file_attributes() & 0x400 != 0 || windows_number_of_links(path)? > 1 {
            return Err(Error::Invalid(format!("reparse point or hard link rejected: {}", path.display())));
        }
    }
    Ok(metadata)
}

fn existing_nolink(path: &Path) -> Result<Option<fs::Metadata>> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            if meta.file_type().is_symlink() { return Err(Error::Invalid(format!("symlink/reparse point rejected: {}", path.display()))); }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0
                    || (meta.is_file() && windows_number_of_links(path)? > 1)
                {
                    return Err(Error::Invalid(format!("reparse point or hard link rejected: {}", path.display())));
                }
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                if meta.is_file() && meta.nlink() > 1 {
                    return Err(Error::Invalid(format!("hard link rejected: {}", path.display())));
                }
            }
            Ok(Some(meta))
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(Error::Io(e)),
    }
}

pub fn hash_file(path: &Path) -> Result<(u64, String)> {
    let meta = check_regular_file(path)?;
    let mut file = File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop { let n = file.read(&mut buf)?; if n == 0 { break; } h.update(&buf[..n]); }
    Ok((meta.len(), format!("{:x}", h.finalize())))
}

fn collect_files(root: &Path, base: &Path, out: &mut Vec<InstallFile>) -> Result<()> {
    for item in fs::read_dir(root)? {
        let item = item?;
        let path = item.path();
        let rel = path.strip_prefix(base).map_err(|e| Error::Invalid(e.to_string()))?.to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/");
        let meta = fs::symlink_metadata(&path)?;
        if meta.file_type().is_symlink() { return Err(Error::Invalid(format!("symlink rejected: {rel}"))); }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err(Error::Invalid(format!("reparse point rejected: {rel}")));
            }
        }
        if meta.is_dir() { collect_files(&path, base, out)?; }
        else if meta.is_file() {
            if rel == INSTALL_MANIFEST_NAME || rel == INSTALL_PROOF_NAME { continue; }
            let (size, sha256) = hash_file(&path)?;
            #[cfg(unix)]
            use std::os::unix::fs::PermissionsExt;
            #[cfg(unix)]
            let executable = meta.permissions().mode() & 0o111 != 0;
            #[cfg(not(unix))]
            let executable = false;
            let policy = if rel == "settings.ini" { FilePolicy::Preserve } else { FilePolicy::Managed };
            out.push(InstallFile { path: rel, size, sha256, executable, policy });
        } else { return Err(Error::Invalid(format!("special file rejected: {rel}"))); }
        if out.len() > MAX_ENTRIES { return Err(Error::Limit("too many files".into())); }
    }
    Ok(())
}

pub fn inventory_directory(root: &Path, target: &str, release_tag: &str) -> Result<InstallManifestV1> {
    if !root.is_dir() { return Err(Error::Invalid("inventory root is not a directory".into())); }
    let mut files = Vec::new();
    collect_files(root, root, &mut files)?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let manifest = InstallManifestV1 { version: 1, target: target.to_owned(), release_tag: release_tag.to_owned(), files };
    validate_install_manifest(&manifest)?;
    Ok(manifest)
}
pub fn generate_inventory(root: &Path, target: &str, release_tag: &str) -> Result<InstallManifestV1> { inventory_directory(root, target, release_tag) }

pub fn verify_inventory(root: &Path, manifest: &InstallManifestV1) -> Result<()> {
    validate_install_manifest(manifest)?;
    for f in &manifest.files {
        let path = path_for(root, &f.path);
        let (size, digest) = hash_file(&path).map_err(|_| Error::Invalid(format!("missing or invalid file {}", f.path)))?;
        if size != f.size || !digest.eq_ignore_ascii_case(&f.sha256) { return Err(Error::Invalid(format!("inventory digest mismatch {}", f.path))); }
    }
    Ok(())
}

/// Signing jobs may assemble a package without a user-owned preserve file.
/// Every present entry is still verified; only an absent preserve-policy entry
/// is tolerated. Managed entries are always required.
pub fn verify_inventory_for_signing(root: &Path, manifest: &InstallManifestV1) -> Result<()> {
    validate_install_manifest(manifest)?;
    let actual = inventory_directory(root, &manifest.target, &manifest.release_tag)?;
    let expected: BTreeMap<_, _> = manifest.files.iter().map(|file| (file.path.as_str(), file)).collect();
    for file in &actual.files {
        let Some(expected_file) = expected.get(file.path.as_str()) else { return Err(Error::Invalid(format!("unlisted package file {}", file.path))); };
        if expected_file.size != file.size || expected_file.sha256 != file.sha256 || expected_file.policy != file.policy { return Err(Error::Invalid(format!("inventory digest mismatch {}", file.path))); }
    }
    for f in &manifest.files {
        let path = path_for(root, &f.path);
        if f.policy == FilePolicy::Preserve && existing_nolink(&path)?.is_none() { continue; }
        let (size, digest) = hash_file(&path).map_err(|_| Error::Invalid(format!("missing or invalid file {}", f.path)))?;
        if size != f.size || !digest.eq_ignore_ascii_case(&f.sha256) { return Err(Error::Invalid(format!("inventory digest mismatch {}", f.path))); }
    }
    Ok(())
}

/// Authenticate the installed inventory against the signed release metadata
/// shipped with the package. A self-consistent local manifest is not enough to
/// authorize deletion or replacement: the signed target digest is the anchor.
pub fn authenticate_current_inventory(root: &Path, proof: &InstalledInventoryProof, registry: &[PublicKeyEntry], target: &str) -> Result<InstallManifestV1> {
    verify_inventory_proof(proof, registry)?;
    let local = read_install_manifest(root)?;
    if local.target != target || local.release_tag != proof.release_tag || proof.target != target { return Err(Error::Signature("installed release metadata mismatch".into())); }
    if manifest_sha256(&local)? != proof.install_manifest_sha256 { return Err(Error::Signature("installed inventory is not signed".into())); }
    // The complete inventory is signed above. Preserve-policy file contents
    // are user-owned after installation and are therefore not re-hashed here.
    for file in local.files.iter().filter(|f| f.policy == FilePolicy::Managed) {
        let path = path_for(root, &file.path);
        let (size, digest) = hash_file(&path)?;
        if size != file.size || !digest.eq_ignore_ascii_case(&file.sha256) { return Err(Error::Signature(format!("managed inventory tampering {}", file.path))); }
    }
    Ok(local)
}

/// Authenticate the target package proof and its complete inventory before a
/// transaction is allowed to mutate the installed root. The proof's managed
/// digest is checked against the manifest and the public-key registry; a
/// self-consistent but unsigned archive is not installable.
pub fn authenticate_target_inventory(target_root: &Path, target: &InstallManifestV1, registry: &[PublicKeyEntry]) -> Result<InstalledInventoryProof> {
    let proof = read_inventory_proof(target_root)?;
    verify_inventory_proof(&proof, registry)?;
    if proof.repository != REPOSITORY || proof.channel != CHANNEL ||
        proof.release_tag != target.release_tag || proof.target != target.target ||
        manifest_sha256(target)? != proof.install_manifest_sha256 {
        return Err(Error::Signature("target inventory proof does not bind package".into()));
    }
    verify_inventory(target_root, target)?;
    Ok(proof)
}

fn ensure_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
    Ok(())
}

pub fn extract_archive(bytes: &[u8], destination: &Path) -> Result<InstallManifestV1> {
    if bytes.len() as u64 > MAX_ARCHIVE_BYTES { return Err(Error::Limit("archive exceeds 512 MiB".into())); }
    if destination.exists() { return Err(Error::Invalid("extraction destination already exists".into())); }
    fs::create_dir_all(destination)?;
    let result = if bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") {
        extract_zip(bytes, destination)
    } else {
        extract_tar(bytes, destination)
    };
    if result.is_err() { let _ = fs::remove_dir_all(destination); }
    result?;
    normalize_archive_root(destination)?;
    let file_manifest = read_install_manifest(destination)?;
    let proof = read_inventory_proof(destination)?;
    if proof.release_tag != file_manifest.release_tag || proof.target != file_manifest.target || manifest_sha256(&file_manifest)? != proof.install_manifest_sha256 { return Err(Error::Invalid("installed proof does not bind inventory".into())); }
    let expected = manifest_sha256(&file_manifest)?;
    let actual = sha256_hex(&canonical_json(&file_manifest)?);
    if expected != actual { return Err(Error::Invalid("manifest hash calculation failed".into())); }
    Ok(file_manifest)
}

fn normalize_archive_root(destination: &Path) -> Result<()> {
    if destination.join(INSTALL_MANIFEST_NAME).is_file() { return Ok(()); }
    let mut children = fs::read_dir(destination)?;
    let Some(first) = children.next() else { return Err(Error::Invalid("archive is empty".into())); };
    let first = first?.path();
    if !first.is_dir() || children.next().is_some() { return Err(Error::Invalid("archive has no unambiguous package root".into())); }
    for item in fs::read_dir(&first)? {
        let item = item?; let name = item.file_name(); let target = destination.join(name);
        if existing_nolink(&target)?.is_some() { return Err(Error::Invalid("package-root collision".into())); }
        fs::rename(item.path(), target)?;
    }
    fs::remove_dir(first)?;
    Ok(())
}
pub fn extract_archive_secure(bytes: &[u8], destination: &Path) -> Result<InstallManifestV1> { extract_archive(bytes, destination) }

fn extract_zip(bytes: &[u8], destination: &Path) -> Result<()> {
    let reader = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader)?;
    let mut paths = BTreeSet::new(); let mut folded = BTreeSet::new(); let mut total = 0u64;
    for i in 0..archive.len() {
        if i >= MAX_ENTRIES { return Err(Error::Limit("too many archive entries".into())); }
        let mut entry = archive.by_index(i)?;
        if entry.name().contains('\\') { return Err(Error::Invalid("backslash archive path rejected".into())); }
        let raw = entry.name().to_owned();
        if raw.ends_with('/') { validate_rel_path(raw.trim_end_matches('/'))?; continue; }
        validate_rel_path(&raw)?;
        if !paths.insert(raw.clone()) || !folded.insert(raw.to_ascii_lowercase()) { return Err(Error::Invalid("duplicate archive path".into())); }
        if entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) { return Err(Error::Invalid("symlink archive entry".into())); }
        let size = entry.size();
        total = total.checked_add(size).ok_or_else(|| Error::Limit("extracted size overflow".into()))?;
        if total > MAX_EXTRACTED_BYTES { return Err(Error::Limit("extracted data exceeds 2 GiB".into())); }
        let path = path_for(destination, &raw); ensure_parent(&path)?;
        let mut out = OpenOptions::new().write(true).create_new(true).open(&path)?;
        let copied = io::copy(&mut entry.by_ref().take(size), &mut out)?;
        if copied != size { return Err(Error::Invalid("truncated zip entry".into())); }
        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&path, fs::Permissions::from_mode(mode & 0o7777))?; }
    }
    Ok(())
}

fn extract_tar(bytes: &[u8], destination: &Path) -> Result<()> {
    let reader: Box<dyn Read> = if bytes.starts_with(&[0x1f, 0x8b]) { Box::new(flate2::read::GzDecoder::new(std::io::Cursor::new(bytes))) } else { Box::new(std::io::Cursor::new(bytes)) };
    let mut archive = tar::Archive::new(reader);
    let mut paths = BTreeSet::new(); let mut folded = BTreeSet::new(); let mut total = 0u64; let mut count = 0usize;
    for item in archive.entries().map_err(|e| Error::Invalid(e.to_string()))? {
        count += 1; if count > MAX_ENTRIES { return Err(Error::Limit("too many archive entries".into())); }
        let mut entry = item.map_err(|e| Error::Invalid(e.to_string()))?;
        let raw_path = entry.path().map_err(|e| Error::Invalid(e.to_string()))?;
        let raw = raw_path.to_str().ok_or_else(|| Error::Invalid("non-UTF-8 archive path rejected".into()))?.to_owned();
        if raw.contains('\\') { return Err(Error::Invalid("backslash archive path rejected".into())); }
        if entry.header().entry_type().is_dir() { validate_rel_path(raw.trim_end_matches('/'))?; continue; }
        if !entry.header().entry_type().is_file() { return Err(Error::Invalid("tar link/special entry rejected".into())); }
        validate_rel_path(&raw)?;
        if !paths.insert(raw.clone()) || !folded.insert(raw.to_ascii_lowercase()) { return Err(Error::Invalid("duplicate archive path".into())); }
        let size = entry.size(); total = total.checked_add(size).ok_or_else(|| Error::Limit("extracted size overflow".into()))?;
        if total > MAX_EXTRACTED_BYTES { return Err(Error::Limit("extracted data exceeds 2 GiB".into())); }
        let path = path_for(destination, &raw); ensure_parent(&path)?;
        #[cfg(unix)]
        let mode = entry.header().mode().ok();
        let mut out = OpenOptions::new().write(true).create_new(true).open(&path)?;
        let copied = io::copy(&mut entry.by_ref().take(size), &mut out)?;
        if copied != size { return Err(Error::Invalid("truncated tar entry".into())); }
        #[cfg(unix)]
        if let Some(mode) = mode { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&path, fs::Permissions::from_mode(mode & 0o7777))?; }
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct JournalEntry {
    pub operation: String,
    pub path: String,
    pub backup: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub phase: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct TransactionState {
    pub version: u32,
    pub install_root: String,
    pub target_tag: String,
    pub entries: Vec<JournalEntry>,
    pub lifecycle: String,
    pub pending_confirm: bool,
}

pub fn transaction_dir(install_root: &Path) -> PathBuf {
    let name = install_root.file_name().and_then(|s| s.to_str()).unwrap_or("install");
    install_root.parent().unwrap_or_else(|| Path::new(".")).join(format!(".{name}.multiwfn-updater-txn"))
}

/// Candidate metadata and extracted bytes are separate from the active
/// transaction journal. A ready candidate must not look like a recovery state.
pub fn candidate_dir(install_root: &Path) -> PathBuf {
    let name = install_root.file_name().and_then(|s| s.to_str()).unwrap_or("install");
    install_root.parent().unwrap_or_else(|| Path::new(".")).join(format!(".{name}.multiwfn-updater-candidate"))
}

pub fn stage_dir(install_root: &Path) -> PathBuf { candidate_dir(install_root).join("stage") }

fn validate_transaction_state(state: &TransactionState) -> Result<()> {
    let root = Path::new(&state.install_root);
    if state.version != 1 || state.install_root.is_empty() || state.entries.len() > MAX_ENTRIES.saturating_mul(2) {
        return Err(Error::Conflict("invalid transaction journal".into()));
    }
    if !matches!(state.lifecycle.as_str(), "applying" | "installed") {
        return Err(Error::Conflict("invalid transaction lifecycle".into()));
    }
    if (state.lifecycle == "installed") != state.pending_confirm {
        return Err(Error::Conflict("transaction lifecycle confirmation mismatch".into()));
    }
    if state.lifecycle == "installed" && (state.entries.is_empty() || state.entries.iter().any(|entry| entry.phase != "applied")) {
        return Err(Error::Conflict("installed transaction is incomplete".into()));
    }
    let txn = transaction_dir(root);
    let stage = stage_dir(root);
    for (index, entry) in state.entries.iter().enumerate() {
        validate_rel_path(&entry.path)?;
        if !matches!(entry.operation.as_str(), "replace" | "remove" | "manifest" | "proof") {
            return Err(Error::Conflict("invalid transaction operation".into()));
        }
        if !matches!(entry.phase.as_str(), "" | "planned" | "backedUp" | "applied") {
            return Err(Error::Conflict("invalid transaction phase".into()));
        }
        if let Some(backup) = &entry.backup {
            if backup != &backup_path(&txn, index).display().to_string() { return Err(Error::Conflict("transaction backup escapes journal".into())); }
        }
        if let Some(source) = &entry.source {
            let source_path = Path::new(source);
            let relative = source_path.strip_prefix(&stage).map_err(|_| Error::Conflict("transaction source escapes candidate stage".into()))?;
            validate_rel_path(&relative.to_string_lossy())?;
        }
    }
    Ok(())
}

fn write_state(dir: &Path, state: &TransactionState) -> Result<()> {
    fs::create_dir_all(dir)?;
    let path = dir.join("journal.json");
    let tmp = dir.join("journal.json.tmp");
    let bytes = canonical_json(state)?;
    if bytes.len() > MAX_JOURNAL_BYTES { return Err(Error::Limit("transaction journal exceeds 16 MiB".into())); }
    fs::write(&tmp, bytes)?;
    File::open(&tmp)?.sync_all()?;
    durable_replace(&tmp, &path)?;
    sync_directory(dir)?;
    if let Some(parent) = dir.parent() { sync_directory(parent)?; }
    Ok(())
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<()> {
    File::open(path)?.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<()> { Ok(()) }

#[cfg(windows)]
#[allow(unsafe_code)]
fn windows_durable_rename(source: &Path, destination: &Path, replace: bool) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH};
    let source_w: Vec<u16> = source.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let destination_w: Vec<u16> = destination.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let flags = MOVEFILE_WRITE_THROUGH | if replace { MOVEFILE_REPLACE_EXISTING } else { 0 };
    let moved = unsafe { MoveFileExW(source_w.as_ptr(), destination_w.as_ptr(), flags) } != 0;
    if moved { Ok(()) } else { Err(Error::Io(io::Error::last_os_error())) }
}

fn durable_rename(source: &Path, destination: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        windows_durable_rename(source, destination, false)?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        fs::rename(source, destination)?;
        if let Some(parent) = source.parent() { sync_directory(parent)?; }
        if let Some(parent) = destination.parent() {
            if Some(parent) != source.parent() { sync_directory(parent)?; }
        }
        Ok(())
    }
}

fn durable_replace(source: &Path, destination: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        windows_durable_rename(source, destination, true)?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        fs::rename(source, destination)?;
        if let Some(parent) = source.parent() { sync_directory(parent)?; }
        if let Some(parent) = destination.parent() {
            if Some(parent) != source.parent() { sync_directory(parent)?; }
        }
        Ok(())
    }
}

fn sync_regular_file(path: &Path) -> Result<()> {
    check_regular_file(path)?;
    File::open(path)?.sync_all()?;
    Ok(())
}

pub fn load_transaction(install_root: &Path) -> Result<Option<TransactionState>> {
    let dir = transaction_dir(install_root);
    let Some(meta) = existing_nolink(&dir)? else { return Ok(None); };
    if !meta.is_dir() { return Err(Error::Conflict("transaction path is not a directory".into())); }
    let path = dir.join("journal.json");
    if !path.is_file() { return Err(Error::Conflict("transaction journal is missing".into())); }
    let bytes = fs::read(path)?;
    if bytes.len() > MAX_JOURNAL_BYTES { return Err(Error::Limit("transaction journal exceeds 16 MiB".into())); }
    let state: TransactionState = serde_json::from_slice(&bytes)?;
    if state.install_root != install_root.display().to_string() { return Err(Error::Conflict("invalid transaction journal root".into())); }
    validate_transaction_state(&state)?;
    Ok(Some(state))
}

fn journal_entry(state: &mut TransactionState, txn: &Path, operation: &str, path: &str, backup: Option<String>, source: Option<String>) -> Result<usize> {
    state.entries.push(JournalEntry { operation: operation.into(), path: path.into(), backup, source, phase: "planned".into() });
    write_state(txn, state)?;
    Ok(state.entries.len() - 1)
}

fn journal_phase(state: &mut TransactionState, txn: &Path, index: usize, phase: &str) -> Result<()> {
    state.entries[index].phase = phase.into();
    write_state(txn, state)
}

fn backup_path(txn: &Path, index: usize) -> PathBuf { txn.join("backups").join(format!("{index:016x}")) }

fn move_replace(state: &mut TransactionState, txn: &Path, root: &Path, source: &Path, rel: &str, operation: &str) -> Result<()> {
    let destination = path_for(root, rel);
    let backup = if existing_nolink(&destination)?.is_some() { Some(backup_path(txn, state.entries.len()).display().to_string()) } else { None };
    let index = journal_entry(state, txn, operation, rel, backup.clone(), Some(source.display().to_string()))?;
    if let Some(backup) = backup {
        durable_rename(&destination, Path::new(&backup))?;
        journal_phase(state, txn, index, "backedUp")?;
    }
    durable_rename(source, &destination)?;
    #[cfg(test)]
    if INJECT_FAILURE_AFTER_RENAME.with(|flag| flag.replace(false)) {
        return Err(Error::Io(io::Error::other("injected post-rename failure")));
    }
    journal_phase(state, txn, index, "applied")?;
    Ok(())
}

fn move_remove(state: &mut TransactionState, txn: &Path, root: &Path, rel: &str) -> Result<()> {
    let destination = path_for(root, rel);
    if existing_nolink(&destination)?.is_none() { return Ok(()); }
    let backup = backup_path(txn, state.entries.len());
    let index = journal_entry(state, txn, "remove", rel, Some(backup.display().to_string()), None)?;
    durable_rename(&destination, &backup)?;
    journal_phase(state, txn, index, "applied")?;
    let mut parent = destination.parent();
    while let Some(directory) = parent.filter(|directory| *directory != root) {
        match fs::remove_dir(directory) {
            Ok(()) => {
                if let Some(grandparent) = directory.parent() { sync_directory(grandparent)?; }
                parent = directory.parent();
            }
            Err(error) if matches!(error.kind(), io::ErrorKind::DirectoryNotEmpty) => break,
            Err(error) if error.kind() == io::ErrorKind::NotFound => break,
            Err(error) => return Err(Error::Io(error)),
        }
    }
    Ok(())
}

/// Apply a target inventory transactionally.  All conflict checks happen before
/// the first rename, so ordinary conflicts are all-or-nothing.
pub fn apply_transaction(install_root: &Path, target_root: &Path, target: &InstallManifestV1) -> Result<TransactionState> {
    if !install_root.is_dir() { return Err(Error::Invalid("install root is not a directory".into())); }
    let stage = stage_dir(install_root);
    if target_root != stage.as_path() { return Err(Error::Invalid("transaction target must be the candidate stage".into())); }
    let probe = install_root.join(".multiwfn-updater-write-probe");
    OpenOptions::new().write(true).create_new(true).open(&probe).map_err(Error::Io)?.sync_all()?;
    fs::remove_file(&probe)?;
    validate_install_manifest(target)?; verify_inventory(target_root, target)?;
    let current = read_install_manifest(install_root).ok();
    if let Some(ref m) = current {
        for file in m.files.iter().filter(|f| f.policy == FilePolicy::Managed) {
            let (size, digest) = hash_file(&path_for(install_root, &file.path))?;
            if size != file.size || !digest.eq_ignore_ascii_case(&file.sha256) { return Err(Error::Conflict(format!("modified managed file {}", file.path))); }
        }
    }
    let current_map: BTreeMap<_, _> = current.as_ref().map(|m| m.files.iter().map(|f| (f.path.clone(), f)).collect()).unwrap_or_default();
    let target_map: BTreeMap<_, _> = target.files.iter().map(|f| (f.path.clone(), f)).collect();
    for f in &target.files {
        let path = path_for(install_root, &f.path);
        if f.policy == FilePolicy::Managed && existing_nolink(&path)?.is_some() && !current_map.contains_key(&f.path) { return Err(Error::Conflict(format!("unknown file collision {}", f.path))); }
        if f.policy == FilePolicy::Preserve {
            if let Some(meta) = existing_nolink(&path)? {
                if !meta.is_file() { return Err(Error::Conflict(format!("preserve path is not a regular file {}", f.path))); }
            }
        }
        // A file may not be written through an unknown regular-file parent,
        // and no symlink/reparse parent is ever traversed.
        let mut parent = path.parent();
        while let Some(p) = parent.filter(|p| *p != install_root) {
            if let Some(meta) = existing_nolink(p)? {
                if meta.is_file() { return Err(Error::Conflict(format!("unknown parent-file collision {}", f.path))); }
            }
            parent = p.parent();
        }
    }
    for f in &target.files {
        sync_regular_file(&path_for(target_root, &f.path))?;
    }
    sync_regular_file(&path_for(target_root, INSTALL_MANIFEST_NAME))?;
    sync_regular_file(&path_for(target_root, INSTALL_PROOF_NAME))?;
    sync_directory(target_root)?;
    let txn = transaction_dir(install_root); if existing_nolink(&txn)?.is_some() { return Err(Error::Conflict("unfinished transaction exists".into())); }
    fs::create_dir_all(txn.join("backups"))?;
    let mut state = TransactionState { version: 1, install_root: install_root.display().to_string(), target_tag: target.release_tag.clone(), entries: Vec::new(), lifecycle: "applying".into(), pending_confirm: false };
    write_state(&txn, &state)?;
    let result = (|| {
        for f in &target.files {
            let path = path_for(install_root, &f.path);
            if f.policy == FilePolicy::Preserve && existing_nolink(&path)?.is_some() { continue; }
            let source = path_for(target_root, &f.path);
            let _ = check_regular_file(&source)?;
            ensure_parent(&path)?;
            move_replace(&mut state, &txn, install_root, &source, &f.path, "replace")?;
        }
        if let Some(m) = &current {
            for f in m.files.iter().filter(|f| f.policy == FilePolicy::Managed) {
                if !target_map.contains_key(&f.path) {
                    move_remove(&mut state, &txn, install_root, &f.path)?;
                }
            }
        }
        let target_manifest = path_for(target_root, INSTALL_MANIFEST_NAME);
        let target_proof = path_for(target_root, INSTALL_PROOF_NAME);
        let _ = check_regular_file(&target_manifest)?;
        let _ = check_regular_file(&target_proof)?;
        move_replace(&mut state, &txn, install_root, &target_manifest, INSTALL_MANIFEST_NAME, "manifest")?;
        move_replace(&mut state, &txn, install_root, &target_proof, INSTALL_PROOF_NAME, "proof")?;
        sync_directory(install_root)?;
        state.lifecycle = "installed".into();
        state.pending_confirm = true;
        write_state(&txn, &state)?;
        Ok::<(), Error>(())
    })();
    if let Err(e) = result {
        if let Err(recovery) = rollback_state(&state) {
            // Keep the fsynced journal and backups for the next invocation;
            // silently deleting them would make recovery impossible.
            return Err(Error::Conflict(format!("update failed ({e}); rollback also failed ({recovery})")));
        }
        if let Err(cleanup) = clear_candidate(install_root) {
            return Err(Error::Conflict(format!("update failed ({e}); candidate cleanup failed ({cleanup})")));
        }
        let _ = fs::remove_dir_all(&txn);
        return Err(e);
    }
    Ok(state)
}
pub fn install_transaction(install_root: &Path, target_root: &Path, target: &InstallManifestV1) -> Result<TransactionState> { apply_transaction(install_root, target_root, target) }

pub fn apply_authenticated_transaction(install_root: &Path, target_root: &Path, target: &InstallManifestV1, current_proof: &InstalledInventoryProof, registry: &[PublicKeyEntry]) -> Result<TransactionState> {
    authenticate_current_inventory(install_root, current_proof, registry, &target.target)?;
    authenticate_target_inventory(target_root, target, registry)?;
    apply_transaction(install_root, target_root, target)
}

pub fn rollback_state(state: &TransactionState) -> Result<()> {
    validate_transaction_state(state)?;
    let root = Path::new(&state.install_root);
    for entry in state.entries.iter().rev() {
        let path = path_for(root, &entry.path);
        let backup_exists = match entry.backup.as_deref() {
            Some(backup) => existing_nolink(Path::new(backup))?.is_some(),
            None => false,
        };
        let destination_exists = existing_nolink(&path)?.is_some();
        let staged_source_missing = match entry.source.as_deref() {
            Some(source) => existing_nolink(Path::new(source))?.is_none(),
            None => false,
        };
        let should_remove = if entry.backup.is_some() {
            backup_exists && matches!(entry.phase.as_str(), "" | "planned" | "backedUp" | "applied")
        } else {
            destination_exists && (entry.phase == "applied" || (entry.phase == "planned" && staged_source_missing))
        };
        if should_remove && destination_exists {
            let meta = existing_nolink(&path)?.ok_or_else(|| Error::Conflict(format!("rollback path disappeared: {}", path.display())))?;
            if !meta.is_file() { return Err(Error::Conflict(format!("rollback encountered non-file: {}", path.display()))); }
            fs::remove_file(&path)?;
            if let Some(parent) = path.parent() { sync_directory(parent)?; }
        }
        if let Some(backup) = &entry.backup {
            if existing_nolink(Path::new(backup))?.is_some() {
                ensure_parent(&path)?;
                durable_rename(Path::new(backup), &path)?;
            }
        }
    }
    Ok(())
}

pub fn confirm_transaction(install_root: &Path) -> Result<()> {
    let Some(state) = load_transaction(install_root)? else { return Err(Error::Invalid("no pending transaction".into())); };
    if state.lifecycle != "installed" || !state.pending_confirm { return Err(Error::Conflict("transaction is not durably installed".into())); }
    clear_candidate(install_root)?;
    fs::remove_dir_all(transaction_dir(install_root))?;
    Ok(())
}

pub fn rollback_last(install_root: &Path) -> Result<()> {
    let Some(state) = load_transaction(install_root)? else { return Err(Error::Invalid("no transaction to roll back".into())); };
    rollback_state(&state)?;
    clear_candidate(install_root)?;
    fs::remove_dir_all(transaction_dir(install_root))?;
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CandidateState {
    pub install_root: String,
    pub tag: String,
    pub target: String,
    pub archive_path: String,
    pub archive_url: String,
    pub manifest: SignedReleaseManifest,
}

pub fn state_path(install_root: &Path) -> PathBuf { candidate_dir(install_root).join("candidate.json") }
pub fn save_candidate(install_root: &Path, candidate: &CandidateState) -> Result<()> {
    if candidate.install_root != install_root.display().to_string() { return Err(Error::Invalid("candidate install root mismatch".into())); }
    let dir = candidate_dir(install_root);
    if let Some(p) = dir.parent() { fs::create_dir_all(p)?; }
    fs::create_dir_all(&dir)?;
    let path = state_path(install_root);
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, canonical_json(candidate)?)?;
    File::open(&tmp)?.sync_all()?;
    durable_replace(&tmp, &path)?;
    sync_directory(&dir)?;
    if let Some(parent) = dir.parent() { sync_directory(parent)?; }
    Ok(())
}
pub fn load_candidate(install_root: &Path) -> Result<Option<CandidateState>> {
    let path = state_path(install_root);
    if !path.is_file() { return Ok(None); }
    let bytes = fs::read(path)?;
    if bytes.len() > MAX_JSON_BYTES { return Err(Error::Limit("candidate state exceeds 64 KiB".into())); }
    let candidate: CandidateState = serde_json::from_slice(&bytes)?;
    if candidate.install_root != install_root.display().to_string() { return Err(Error::Conflict("candidate install root mismatch".into())); }
    Ok(Some(candidate))
}
pub fn clear_candidate(install_root: &Path) -> Result<()> {
    let dir = candidate_dir(install_root);
    match existing_nolink(&dir)? {
        Some(meta) if meta.is_dir() => {
            let mut has_entries = false;
            for item in fs::read_dir(&dir)? {
                has_entries = true;
                let item = item?;
                let name = item.file_name();
                let name = name.to_str().ok_or_else(|| Error::Conflict("candidate contains a non-UTF-8 path".into()))?;
                let expected_helper = if cfg!(windows) {
                    "multiwfn-matterviz-updater-helper.exe"
                } else {
                    "multiwfn-matterviz-updater-helper"
                };
                if !matches!(name, "candidate.json" | "candidate.json.tmp" | "stage")
                    && name != expected_helper
                {
                    return Err(Error::Conflict(format!("unknown candidate file {name}")));
                }
                let item_meta = existing_nolink(&item.path())?
                    .ok_or_else(|| Error::Conflict("candidate entry disappeared".into()))?;
                if (name == "stage") != item_meta.is_dir() {
                    return Err(Error::Conflict(format!("invalid candidate entry {name}")));
                }
            }
            if has_entries && !state_path(install_root).is_file() {
                return Err(Error::Conflict("candidate ownership metadata is missing".into()));
            }
            fs::remove_dir_all(&dir)?;
            if let Some(parent) = dir.parent() { sync_directory(parent)?; }
            Ok(())
        }
        Some(_) => Err(Error::Conflict("candidate path is not a directory".into())),
        None => Ok(()),
    }
}

pub trait ReleaseClient {
    fn releases(&self) -> Result<Vec<RemoteRelease>>;
    fn download(&self, url: &str) -> Result<Vec<u8>>;
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RemoteAsset { pub name: String, pub size: u64, pub browser_download_url: String, #[serde(default)] pub digest: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RemoteRelease { pub tag_name: String, #[serde(default)] pub prerelease: bool, pub assets: Vec<RemoteAsset> }

pub struct GitHubClient { client: reqwest::blocking::Client }
impl GitHubClient {
    pub fn new() -> Result<Self> {
        let client = reqwest::blocking::Client::builder().user_agent("Multiwfn-MatterViz-Updater/1").timeout(Duration::from_secs(30)).redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !GitHubClient::allowed(attempt.url().as_str()) { attempt.stop() } else { attempt.follow() }
        })).build().map_err(|e| Error::Network(e.to_string()))?;
        Ok(Self { client })
    }
    fn allowed(url: &str) -> bool { url::Url::parse(url).is_ok_and(|u| u.scheme() == "https" && matches!(u.host_str(), Some("api.github.com") | Some("github.com") | Some("objects.githubusercontent.com") | Some("release-assets.githubusercontent.com"))) }
    pub fn download_bounded(&self, url: &str, limit: u64) -> Result<Vec<u8>> {
        if !Self::allowed(url) { return Err(Error::Network("download host is not allowlisted".into())); }
        let response = self.client.get(url).send().map_err(|e| Error::Network(e.to_string()))?;
        if !response.status().is_success() { return Err(Error::Network(format!("download status {}", response.status()))); }
        if response.content_length().is_some_and(|size| size > limit) { return Err(Error::Limit("download exceeds configured limit".into())); }
        let mut bytes = Vec::new();
        response.take(limit.saturating_add(1)).read_to_end(&mut bytes).map_err(|e| Error::Network(e.to_string()))?;
        if bytes.len() as u64 > limit { return Err(Error::Limit("download exceeds configured limit".into())); }
        Ok(bytes)
    }
}
impl ReleaseClient for GitHubClient {
    fn releases(&self) -> Result<Vec<RemoteRelease>> {
        let url = format!("https://api.github.com/repos/{REPOSITORY}/releases?per_page=100");
        let response = self.client.get(url).send().map_err(|e| Error::Network(e.to_string()))?;
        if !response.status().is_success() { return Err(Error::Network(format!("GitHub status {}", response.status()))); }
        response.json().map_err(|e| Error::Network(e.to_string()))
    }
    fn download(&self, url: &str) -> Result<Vec<u8>> {
        self.download_bounded(url, MAX_ARCHIVE_BYTES)
    }
}

pub fn select_latest_release<'a>(releases: &'a [RemoteRelease], current: Option<&str>) -> Option<&'a RemoteRelease> {
    releases.iter().filter(|r| r.prerelease && is_newer_preview(&r.tag_name, current)).max_by_key(|r| parse_preview_tag(&r.tag_name).unwrap_or(0))
}

pub fn json_output<T: Serialize>(value: &T) -> Result<String> {
    let text = serde_json::to_string(value)?;
    if text.len() > MAX_JSON_BYTES { return Err(Error::Limit("JSON output exceeds 64 KiB".into())); }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test] fn tags_are_strict_and_ordered() {
        assert_eq!(parse_preview_tag("matterviz-preview-12"), Some(12));
        assert!(parse_preview_tag("matterviz-preview-0").is_none());
        assert!(parse_preview_tag("v1-matterviz.2").is_none());
        assert!(is_newer_preview("matterviz-preview-2", Some("matterviz-preview-1")));
    }

    #[test] fn manifest_rejects_unsafe_paths() {
        let mut m = InstallManifestV1 { version: 1, target: "x".into(), release_tag: "matterviz-preview-1".into(), files: vec![] };
        m.files.push(InstallFile { path: "../x".into(), size: 0, sha256: "0".repeat(64), executable: false, policy: FilePolicy::Managed });
        assert!(validate_install_manifest(&m).is_err());
    }

    #[test] fn inventory_preserves_settings_policy() {
        let d = tempdir().unwrap(); fs::write(d.path().join("settings.ini"), b"x").unwrap();
        let m = inventory_directory(d.path(), "linux-x86_64", "matterviz-preview-1").unwrap();
        assert_eq!(m.files[0].policy, FilePolicy::Preserve);
    }

    #[test] fn signed_manifest_tampering_and_rotation_fail_closed() {
        use ed25519_dalek::pkcs8::EncodePrivateKey;
        let signing = SigningKey::from_bytes(&[7u8; 32]);
        let key = B64.encode(signing.to_pkcs8_der().unwrap().as_bytes());
        let manifest = ReleaseManifestV1 { version: 1, repository: REPOSITORY.into(), tag: "matterviz-preview-2".into(), channel: CHANNEL.into(), targets: vec![ReleaseTarget { target: "linux-x86_64".into(), archive_name: "a.tar.gz".into(), archive_size: 1, archive_sha256: "a".repeat(64), install_manifest_sha256: "b".repeat(64) }] };
        let signed = sign_manifest(&manifest, "k1", &key).unwrap();
        let registry = vec![PublicKeyEntry { version: 1, key_id: "k1".into(), public_key: B64.encode(signing.verifying_key().to_bytes()) }];
        assert!(verify_signed_manifest(&signed, &registry).is_ok());
        let mut tampered = signed.clone(); tampered.manifest.tag = "matterviz-preview-3".into();
        assert!(verify_signed_manifest(&tampered, &registry).is_err());
        assert!(verify_signed_manifest(&signed, &[]).is_err());
    }

    #[test] fn inventory_proof_binds_full_manifest_but_allows_installed_settings_change() {
        use ed25519_dalek::pkcs8::EncodePrivateKey;
        let signing = SigningKey::from_bytes(&[9u8; 32]);
        let key = B64.encode(signing.to_pkcs8_der().unwrap().as_bytes());
        let mut manifest = InstallManifestV1 { version: 1, target: "linux-x86_64".into(), release_tag: "matterviz-preview-1".into(), files: vec![InstallFile { path: "bin".into(), size: 1, sha256: sha256_hex(b"x"), executable: false, policy: FilePolicy::Managed }, InstallFile { path: "settings.ini".into(), size: 1, sha256: sha256_hex(b"a"), executable: false, policy: FilePolicy::Preserve }] };
        let proof = sign_inventory_proof(&manifest, "k", &key).unwrap();
        let registry = vec![PublicKeyEntry { version: 1, key_id: "k".into(), public_key: B64.encode(signing.verifying_key().to_bytes()) }];
        assert!(verify_inventory_proof(&proof, &registry).is_ok());
        manifest.files[1].sha256 = sha256_hex(b"changed");
        assert_ne!(managed_manifest_sha256(&manifest).unwrap(), proof.install_manifest_sha256);
        let mut tampered = proof; tampered.target = "windows-x86_64".into();
        assert!(verify_inventory_proof(&tampered, &registry).is_err());
    }

    fn file_entry(path: &str, bytes: &[u8], policy: FilePolicy) -> InstallFile {
        InstallFile { path: path.into(), size: bytes.len() as u64, sha256: sha256_hex(bytes), executable: false, policy }
    }

    fn stage_with_manifest(root: &Path, manifest: &InstallManifestV1, files: &[(&str, &[u8])]) {
        let stage = stage_dir(root);
        fs::create_dir_all(&stage).unwrap();
        for (path, bytes) in files {
            let destination = path_for(&stage, path);
            ensure_parent(&destination).unwrap();
            fs::write(destination, bytes).unwrap();
        }
        fs::write(stage.join(INSTALL_MANIFEST_NAME), manifest_bytes(manifest).unwrap()).unwrap();
        let proof = InstalledInventoryProof { version: 1, repository: REPOSITORY.into(), channel: CHANNEL.into(), release_tag: manifest.release_tag.clone(), target: manifest.target.clone(), install_manifest_sha256: manifest_sha256(manifest).unwrap(), key_id: "test".into(), signature: "test".into() };
        fs::write(stage.join(INSTALL_PROOF_NAME), serde_json::to_vec(&proof).unwrap()).unwrap();
    }

    fn archive_fixture(root: &Path) -> InstallManifestV1 {
        fs::write(root.join("app"), b"payload").unwrap();
        let manifest = InstallManifestV1 {
            version: 1,
            target: "linux-x86_64".into(),
            release_tag: "matterviz-preview-2".into(),
            files: vec![file_entry("app", b"payload", FilePolicy::Managed)],
        };
        fs::write(root.join(INSTALL_MANIFEST_NAME), manifest_bytes(&manifest).unwrap()).unwrap();
        let proof = InstalledInventoryProof {
            version: 1,
            repository: REPOSITORY.into(),
            channel: CHANNEL.into(),
            release_tag: manifest.release_tag.clone(),
            target: manifest.target.clone(),
            install_manifest_sha256: manifest_sha256(&manifest).unwrap(),
            key_id: "fixture".into(),
            signature: "fixture".into(),
        };
        fs::write(root.join(INSTALL_PROOF_NAME), serde_json::to_vec(&proof).unwrap()).unwrap();
        manifest
    }

    #[test]
    fn extracts_flat_zip_and_single_root_tar_packages() {
        use std::io::{Cursor, Write as _};

        let source = tempdir().unwrap();
        let expected = archive_fixture(source.path());

        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for name in ["app", INSTALL_MANIFEST_NAME, INSTALL_PROOF_NAME] {
            zip.start_file(name, options).unwrap();
            zip.write_all(&fs::read(source.path().join(name)).unwrap()).unwrap();
        }
        let zip_bytes = zip.finish().unwrap().into_inner();
        let zip_destination = tempdir().unwrap();
        let zip_stage = zip_destination.path().join("stage");
        assert_eq!(extract_archive(&zip_bytes, &zip_stage).unwrap(), expected);
        assert_eq!(fs::read(zip_stage.join("app")).unwrap(), b"payload");

        let mut tar = tar::Builder::new(Vec::new());
        tar.append_dir_all("Multiwfn-MatterViz-preview", source.path()).unwrap();
        let tar_bytes = tar.into_inner().unwrap();
        let tar_destination = tempdir().unwrap();
        let tar_stage = tar_destination.path().join("stage");
        assert_eq!(extract_archive(&tar_bytes, &tar_stage).unwrap(), expected);
        assert_eq!(fs::read(tar_stage.join("app")).unwrap(), b"payload");
    }

    #[test] fn candidate_stage_coexists_with_active_transaction_path() {
        let d = tempdir().unwrap();
        fs::create_dir_all(stage_dir(d.path())).unwrap();
        assert!(existing_nolink(&candidate_dir(d.path())).unwrap().is_some());
        assert_ne!(candidate_dir(d.path()), transaction_dir(d.path()));
        assert!(stage_dir(d.path()).is_dir());
        assert!(matches!(clear_candidate(d.path()), Err(Error::Conflict(_))));
        assert!(candidate_dir(d.path()).is_dir());
    }

    #[test] fn candidate_cleanup_preserves_unknown_files() {
        let d = tempdir().unwrap();
        let candidate = candidate_dir(d.path());
        fs::create_dir_all(&candidate).unwrap();
        fs::write(candidate.join("user-sentinel.txt"), b"keep").unwrap();
        assert!(matches!(clear_candidate(d.path()), Err(Error::Conflict(_))));
        assert_eq!(fs::read(candidate.join("user-sentinel.txt")).unwrap(), b"keep");
    }

    #[test] fn transaction_preserves_settings_and_removes_old_managed_file() {
        let d = tempdir().unwrap();
        fs::write(d.path().join("app"), b"old").unwrap();
        fs::write(d.path().join("gone"), b"remove").unwrap();
        fs::write(d.path().join("settings.ini"), b"user").unwrap();
        fs::write(d.path().join("user-sentinel.txt"), b"keep").unwrap();
        let current = InstallManifestV1 { version: 1, target: "linux-x86_64".into(), release_tag: "matterviz-preview-1".into(), files: vec![file_entry("app", b"old", FilePolicy::Managed), file_entry("gone", b"remove", FilePolicy::Managed), file_entry("settings.ini", b"package", FilePolicy::Preserve)] };
        fs::write(d.path().join(INSTALL_MANIFEST_NAME), manifest_bytes(&current).unwrap()).unwrap();
        fs::write(d.path().join(INSTALL_PROOF_NAME), b"old-proof").unwrap();
        let target = InstallManifestV1 { version: 1, target: "linux-x86_64".into(), release_tag: "matterviz-preview-2".into(), files: vec![file_entry("app", b"new", FilePolicy::Managed), file_entry("added", b"official", FilePolicy::Managed), file_entry("settings.ini", b"package-new", FilePolicy::Preserve)] };
        stage_with_manifest(d.path(), &target, &[("app", b"new"), ("added", b"official"), ("settings.ini", b"package-new")]);
        let state = apply_transaction(d.path(), stage_dir(d.path()).as_path(), &target).unwrap();
        assert!(state.pending_confirm);
        assert_eq!(state.lifecycle, "installed");
        assert_eq!(fs::read(d.path().join("app")).unwrap(), b"new");
        assert_eq!(fs::read(d.path().join("added")).unwrap(), b"official");
        assert_eq!(fs::read(d.path().join("settings.ini")).unwrap(), b"user");
        assert_eq!(fs::read(d.path().join("user-sentinel.txt")).unwrap(), b"keep");
        assert!(!d.path().join("gone").exists());
        confirm_transaction(d.path()).unwrap();
        assert!(!transaction_dir(d.path()).exists());
    }

    #[test] fn modified_managed_file_and_new_path_collision_abort_before_writes() {
        let d = tempdir().unwrap();
        fs::write(d.path().join("app"), b"user-modified").unwrap();
        let current = InstallManifestV1 { version: 1, target: "linux-x86_64".into(), release_tag: "matterviz-preview-1".into(), files: vec![file_entry("app", b"old", FilePolicy::Managed)] };
        fs::write(d.path().join(INSTALL_MANIFEST_NAME), manifest_bytes(&current).unwrap()).unwrap();
        let target = InstallManifestV1 { version: 1, target: "linux-x86_64".into(), release_tag: "matterviz-preview-2".into(), files: vec![file_entry("app", b"new", FilePolicy::Managed)] };
        stage_with_manifest(d.path(), &target, &[("app", b"new")]);
        assert!(matches!(apply_transaction(d.path(), stage_dir(d.path()).as_path(), &target), Err(Error::Conflict(_))));
        assert!(!transaction_dir(d.path()).exists());

        let d2 = tempdir().unwrap();
        fs::write(d2.path().join("collision"), b"sentinel").unwrap();
        let current2 = InstallManifestV1 { version: 1, target: "linux-x86_64".into(), release_tag: "matterviz-preview-1".into(), files: vec![] };
        fs::write(d2.path().join(INSTALL_MANIFEST_NAME), manifest_bytes(&current2).unwrap()).unwrap();
        let target2 = InstallManifestV1 { version: 1, target: "linux-x86_64".into(), release_tag: "matterviz-preview-2".into(), files: vec![file_entry("collision", b"package", FilePolicy::Managed)] };
        stage_with_manifest(d2.path(), &target2, &[("collision", b"package")]);
        assert!(matches!(apply_transaction(d2.path(), stage_dir(d2.path()).as_path(), &target2), Err(Error::Conflict(_))));
        assert_eq!(fs::read(d2.path().join("collision")).unwrap(), b"sentinel");
    }

    #[test] fn rollback_restores_journaled_backup() {
        let d = tempdir().unwrap();
        fs::write(d.path().join("app"), b"new").unwrap();
        let txn = transaction_dir(d.path());
        fs::create_dir_all(txn.join("backups")).unwrap();
        fs::write(txn.join("backups/0000000000000000"), b"old").unwrap();
        let state = TransactionState { version: 1, install_root: d.path().display().to_string(), target_tag: "matterviz-preview-2".into(), entries: vec![JournalEntry { operation: "replace".into(), path: "app".into(), backup: Some(txn.join("backups/0000000000000000").display().to_string()), source: None, phase: "applied".into() }], lifecycle: "installed".into(), pending_confirm: true };
        rollback_state(&state).unwrap();
        assert_eq!(fs::read(d.path().join("app")).unwrap(), b"old");
        rollback_state(&state).unwrap();
        assert_eq!(fs::read(d.path().join("app")).unwrap(), b"old");
    }

    #[test] fn installed_settings_content_changes_are_allowed_but_manifest_tamper_is_not() {
        use ed25519_dalek::pkcs8::EncodePrivateKey;
        let d = tempdir().unwrap();
        fs::write(d.path().join("app"), b"x").unwrap();
        fs::write(d.path().join("settings.ini"), b"user-settings").unwrap();
        let manifest = InstallManifestV1 { version: 1, target: "linux-x86_64".into(), release_tag: "matterviz-preview-1".into(), files: vec![file_entry("app", b"x", FilePolicy::Managed), file_entry("settings.ini", b"package-settings", FilePolicy::Preserve)] };
        fs::write(d.path().join(INSTALL_MANIFEST_NAME), manifest_bytes(&manifest).unwrap()).unwrap();
        let signing = SigningKey::from_bytes(&[11u8; 32]);
        let key = B64.encode(signing.to_pkcs8_der().unwrap().as_bytes());
        let proof = sign_inventory_proof(&manifest, "k", &key).unwrap();
        fs::write(d.path().join(INSTALL_PROOF_NAME), serde_json::to_vec(&proof).unwrap()).unwrap();
        let registry = vec![PublicKeyEntry { version: 1, key_id: "k".into(), public_key: B64.encode(signing.verifying_key().to_bytes()) }];
        fs::write(d.path().join("settings.ini"), b"another-user-value").unwrap();
        assert!(authenticate_current_inventory(d.path(), &proof, &registry, "linux-x86_64").is_ok());
        let mut changed = manifest.clone();
        changed.files[1].sha256 = sha256_hex(b"tampered-entry");
        fs::write(d.path().join(INSTALL_MANIFEST_NAME), manifest_bytes(&changed).unwrap()).unwrap();
        assert!(authenticate_current_inventory(d.path(), &proof, &registry, "linux-x86_64").is_err());
    }

    #[test] fn injected_mid_apply_failure_rolls_back_and_clears_journal() {
        let d = tempdir().unwrap();
        fs::write(d.path().join("app"), b"old").unwrap();
        let current = InstallManifestV1 { version: 1, target: "linux-x86_64".into(), release_tag: "matterviz-preview-1".into(), files: vec![file_entry("app", b"old", FilePolicy::Managed)] };
        fs::write(d.path().join(INSTALL_MANIFEST_NAME), manifest_bytes(&current).unwrap()).unwrap();
        let target = InstallManifestV1 { version: 1, target: "linux-x86_64".into(), release_tag: "matterviz-preview-2".into(), files: vec![file_entry("app", b"new", FilePolicy::Managed)] };
        stage_with_manifest(d.path(), &target, &[("app", b"new")]);
        INJECT_FAILURE_AFTER_RENAME.with(|flag| flag.set(true));
        assert!(apply_transaction(d.path(), stage_dir(d.path()).as_path(), &target).is_err());
        assert_eq!(fs::read(d.path().join("app")).unwrap(), b"old");
        assert!(!transaction_dir(d.path()).exists());
    }

    #[test] fn rollback_failure_retains_recovery_journal() {
        let d = tempdir().unwrap();
        fs::create_dir(d.path().join("app")).unwrap();
        let txn = transaction_dir(d.path());
        fs::create_dir_all(txn.join("backups")).unwrap();
        let backup = txn.join("backups/0000000000000000");
        fs::write(&backup, b"old").unwrap();
        let state = TransactionState { version: 1, install_root: d.path().display().to_string(), target_tag: "matterviz-preview-2".into(), entries: vec![JournalEntry { operation: "replace".into(), path: "app".into(), backup: Some(backup.display().to_string()), source: None, phase: "applied".into() }], lifecycle: "installed".into(), pending_confirm: true };
        write_state(&txn, &state).unwrap();
        assert!(rollback_last(d.path()).is_err());
        assert!(transaction_dir(d.path()).is_dir());
        assert!(transaction_dir(d.path()).join("journal.json").is_file());
    }

    #[test] fn applying_journal_is_recovery_and_cannot_be_confirmed() {
        let d = tempdir().unwrap();
        let txn = transaction_dir(d.path());
        fs::create_dir_all(&txn).unwrap();
        let state = TransactionState { version: 1, install_root: d.path().display().to_string(), target_tag: "matterviz-preview-2".into(), entries: Vec::new(), lifecycle: "applying".into(), pending_confirm: false };
        write_state(&txn, &state).unwrap();
        let loaded = load_transaction(d.path()).unwrap().unwrap();
        assert_eq!(loaded.lifecycle, "applying");
        assert!(!loaded.pending_confirm);
        assert!(confirm_transaction(d.path()).is_err());
    }
}
