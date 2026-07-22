#![deny(unsafe_code)]

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ed25519_dalek::SigningKey;
use ed25519_dalek::pkcs8::EncodePrivateKey;
use matterviz_updater::{inventory_directory, json_output, manifest_sha256, sha256_hex, sign_inventory_proof, sign_manifest, verify_inventory_for_signing, verify_signed_manifest, Error, InstallManifestV1, ReleaseManifestV1, ReleaseTarget, SignedReleaseManifest, PublicKeyEntry, REPOSITORY, CHANNEL};
use rand::rngs::OsRng;
use serde::Serialize;
use std::env;
use std::fs;
use std::io::{self, Read};
use std::path::PathBuf;
use zeroize::Zeroizing;

#[derive(Serialize)] struct KeyReply { version: u32, key_id: String, public_key: String }
fn arg(args: &[String], name: &str) -> Result<String, Error> { args.windows(2).find(|p| p[0] == name).map(|p| Ok(p[1].clone())).unwrap_or_else(|| Err(Error::Invalid(format!("missing {name}")))) }
fn optional(args: &[String], name: &str) -> Option<String> { args.windows(2).find(|p| p[0] == name).map(|p| p[1].clone()) }
fn output(path: Option<String>, bytes: &[u8]) -> Result<(), Error> { if let Some(path) = path { fs::write(path, bytes)?; } else { print!("{}", String::from_utf8_lossy(bytes)); } Ok(()) }
fn write_private_key(path: &str, bytes: &[u8]) -> Result<(), Error> {
    use std::fs::OpenOptions;
    use std::io::Write;
    let mut options = OpenOptions::new(); options.write(true).create_new(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    let mut file = options.open(path).map_err(Error::Io)?;
    file.write_all(bytes).map_err(Error::Io)?;
    file.sync_all().map_err(Error::Io)?;
    Ok(())
}
fn read_stdin() -> Result<Zeroizing<String>, Error> { let mut s = String::new(); io::stdin().read_to_string(&mut s)?; Ok(Zeroizing::new(s)) }
fn parse_specs(args: &[String]) -> Result<Vec<(String, PathBuf, PathBuf)>, Error> {
    let mut out = Vec::new();
    for spec in args.iter().filter(|s| s.starts_with("--target=")) {
        let value = &spec[9..]; let (target, rest) = value.split_once('=').ok_or_else(|| Error::Invalid("--target=TARGET=ARCHIVE:INVENTORY".into()))?;
        let (archive, inventory) = rest.split_once(':').ok_or_else(|| Error::Invalid("--target=TARGET=ARCHIVE:INVENTORY".into()))?;
        out.push((target.to_owned(), PathBuf::from(archive), PathBuf::from(inventory)));
    }
    if out.is_empty() { return Err(Error::Invalid("at least one --target=... spec is required".into())); }
    Ok(out)
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let result = run(&args[1..]);
    if let Err(e) = result { eprintln!("{e}"); std::process::exit(1); }
}

fn run(args: &[String]) -> Result<(), Error> {
    let command = args.first().map(String::as_str).unwrap_or("");
    match command {
        "generate-key" => {
            let key_id = optional(args, "--key-id").unwrap_or_else(|| "maintainer-1".into());
            let private_output = arg(args, "--private-output")?;
            let signing = SigningKey::generate(&mut OsRng);
            let der = signing.to_pkcs8_der().map_err(|e| Error::Invalid(e.to_string()))?;
            let private_key = Zeroizing::new(format!("{}\n", B64.encode(der.as_bytes())));
            write_private_key(&private_output, private_key.as_bytes())?;
            let reply = KeyReply { version: 1, key_id, public_key: B64.encode(signing.verifying_key().to_bytes()) };
            println!("{}", json_output(&reply)?);
        }
        "target-id" => {
            let target = match (env::consts::OS, env::consts::ARCH) { ("windows", "x86_64") => "windows-x86_64", ("macos", "aarch64") => "macos-aarch64", ("macos", _) => "macos-x86_64", ("linux", "aarch64") => "linux-aarch64", _ => "linux-x86_64" };
            println!("{target}");
        }
        "inventory" => {
            let root = PathBuf::from(arg(args, "--root")?); let target = arg(args, "--target")?; let tag = arg(args, "--tag")?;
            let manifest = inventory_directory(&root, &target, &tag)?; output(optional(args, "--output"), &serde_json::to_vec_pretty(&manifest)?)?;
        }
        "build-manifest" => {
            let tag = arg(args, "--tag")?; let specs = parse_specs(args)?;
            let targets = specs.into_iter().map(|(target, archive, inventory)| {
                let bytes = fs::read(&archive)?; let m: InstallManifestV1 = serde_json::from_slice(&fs::read(&inventory)?)?;
                if m.target != target || m.release_tag != tag { return Err(Error::Invalid(format!("inventory metadata mismatch for {target}"))); }
                Ok(ReleaseTarget { target, archive_name: archive.file_name().and_then(|s| s.to_str()).ok_or_else(|| Error::Invalid("archive basename".into()))?.to_owned(), archive_size: bytes.len() as u64, archive_sha256: sha256_hex(&bytes), install_manifest_sha256: manifest_sha256(&m)? })
            }).collect::<Result<Vec<_>, Error>>()?;
            let m = ReleaseManifestV1 { version: 1, repository: REPOSITORY.into(), tag, channel: CHANNEL.into(), targets };
            output(optional(args, "--output"), &serde_json::to_vec_pretty(&m)?)?;
        }
        "sign" => {
            let manifest: ReleaseManifestV1 = serde_json::from_slice(&fs::read(arg(args, "--manifest")?)?)?;
            let key_id = arg(args, "--key-id")?; let key = read_stdin()?;
            let signed = sign_manifest(&manifest, &key_id, &key)?;
            output(optional(args, "--output"), &serde_json::to_vec_pretty(&signed)?)?;
        }
        "proof" => {
            let manifest: InstallManifestV1 = serde_json::from_slice(&fs::read(arg(args, "--manifest")?)?)?;
            let root = PathBuf::from(arg(args, "--root")?);
            verify_inventory_for_signing(&root, &manifest)?;
            let key_id = arg(args, "--key-id")?; let key = read_stdin()?;
            let proof = sign_inventory_proof(&manifest, &key_id, &key)?;
            output(optional(args, "--output"), &serde_json::to_vec_pretty(&proof)?)?;
        }
        "verify" => {
            let signed: SignedReleaseManifest = serde_json::from_slice(&fs::read(arg(args, "--manifest")?)?)?;
            let registry: Vec<PublicKeyEntry> = serde_json::from_slice(&fs::read(arg(args, "--registry")?)?)?;
            verify_signed_manifest(&signed, &registry)?; println!("{{\"ok\":true}} ");
        }
        "build-sign" => {
            // Convenience for CI: build a manifest and sign it with PKCS#8 read
            // only from stdin.  The private key is never an argument or log value.
            let tag = arg(args, "--tag")?; let key_id = arg(args, "--key-id")?; let specs = parse_specs(args)?;
            let targets = specs.into_iter().map(|(target, archive, inventory)| {
                let bytes = fs::read(&archive)?; let m: InstallManifestV1 = serde_json::from_slice(&fs::read(&inventory)?)?;
                if m.target != target || m.release_tag != tag { return Err(Error::Invalid(format!("inventory metadata mismatch for {target}"))); }
                Ok(ReleaseTarget { target, archive_name: archive.file_name().and_then(|s| s.to_str()).ok_or_else(|| Error::Invalid("archive basename".into()))?.to_owned(), archive_size: bytes.len() as u64, archive_sha256: sha256_hex(&bytes), install_manifest_sha256: manifest_sha256(&m)? })
            }).collect::<Result<Vec<_>, Error>>()?;
            let manifest = ReleaseManifestV1 { version: 1, repository: REPOSITORY.into(), tag, channel: CHANNEL.into(), targets };
            let key = read_stdin()?; let signed = sign_manifest(&manifest, &key_id, &key)?;
            output(optional(args, "--output"), &serde_json::to_vec_pretty(&signed)?)?;
        }
        _ => return Err(Error::Invalid("commands: generate-key target-id inventory build-manifest sign proof build-sign verify".into())),
    }
    Ok(())
}
