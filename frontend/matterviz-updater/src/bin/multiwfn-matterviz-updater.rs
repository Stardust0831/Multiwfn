#![deny(unsafe_code)]

use matterviz_updater::{
    apply_authenticated_transaction, authenticate_current_inventory_metadata, candidate_dir,
    clear_candidate, confirm_transaction, embedded_key_registry, extract_archive, is_newer_preview,
    json_output, load_candidate, load_transaction, read_install_manifest, rollback_last,
    save_candidate, stage_dir, CandidateState, Error, GitHubClient, ReleaseClient,
};
use serde::Serialize;
use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Reply<'a> {
    format: &'static str,
    version: u32,
    ok: bool,
    command: &'a str,
    state: &'a str,
    current_tag: Option<String>,
    target_tag: Option<String>,
    available: bool,
    staged_ready: bool,
    pending_healthy: bool,
    recovery: bool,
    enabled: bool,
    progress: u8,
    conflicts: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

fn reply(command: &str, root: &Path, result: Result<Option<String>, Error>) -> i32 {
    let current_manifest = read_install_manifest(root).ok();
    let current = current_manifest
        .as_ref()
        .map(|manifest| manifest.release_tag.clone());
    let candidate = load_candidate(root).ok().flatten();
    let staged_ready = stage_dir(root).is_dir();
    let pending = load_transaction(root).ok().flatten();
    let recovery_path = fs::symlink_metadata(matterviz_updater::transaction_dir(root)).is_ok();
    let target = if command == "status" {
        pending.as_ref().map(|s| s.target_tag.clone())
    } else {
        candidate.as_ref().map(|c| c.tag.clone())
    };
    let local_target = host_target().ok();
    let registry = embedded_key_registry().ok();
    let enabled = root.join("settings.ini").is_file()
        && local_target.as_deref().is_some_and(|target| {
            let (Some(manifest), Some(keys)) = (current_manifest.as_ref(), registry.as_deref())
            else {
                return false;
            };
            let Ok(signed) = matterviz_updater::read_inventory_proof(root) else {
                return false;
            };
            authenticate_current_inventory_metadata(manifest, &signed, keys, target).is_ok()
        });
    let value = match result {
        Ok(_tag) => Reply {
            format: "multiwfn-matterviz-update",
            version: 1,
            ok: true,
            command,
            state: if command == "install" {
                "installing"
            } else if recovery_path {
                "recovery"
            } else if staged_ready {
                "ready"
            } else if candidate.is_some() {
                "available"
            } else {
                "idle"
            },
            current_tag: current,
            target_tag: target,
            available: candidate.is_some(),
            staged_ready,
            pending_healthy: pending
                .as_ref()
                .is_some_and(|s| s.lifecycle == "installed" && s.pending_confirm),
            recovery: recovery_path,
            enabled,
            progress: 100,
            conflicts: Vec::new(),
            message: None,
        },
        Err(error) => Reply {
            format: "multiwfn-matterviz-update",
            version: 1,
            ok: false,
            command,
            state: if recovery_path {
                "recovery"
            } else if matches!(&error, Error::Conflict(_)) {
                "conflict"
            } else {
                "error"
            },
            current_tag: current,
            target_tag: target,
            available: candidate.is_some(),
            staged_ready,
            pending_healthy: false,
            recovery: recovery_path,
            enabled,
            progress: 0,
            conflicts: conflict_list(&error),
            message: Some(bound_message(&error.to_string())),
        },
    };
    match json_output(&value) {
        Ok(text) => {
            println!("{text}");
            if value.ok {
                0
            } else {
                1
            }
        }
        Err(error) => {
            eprintln!("{error}");
            1
        }
    }
}

fn install_root() -> PathBuf {
    let exe = env::current_exe()
        .ok()
        .unwrap_or_else(|| PathBuf::from("."));
    let mut cursor = exe
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    for _ in 0..4 {
        if cursor.join("settings.ini").is_file()
            || cursor.join("Multiwfn").is_file()
            || cursor.join("Multiwfn.exe").is_file()
            || cursor
                .join(matterviz_updater::INSTALL_MANIFEST_NAME)
                .is_file()
        {
            return cursor;
        }
        let Some(parent) = cursor.parent() else {
            break;
        };
        if parent == cursor {
            break;
        }
        cursor = parent.to_path_buf();
    }
    exe.parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
fn command_status(root: &Path) -> Result<Option<String>, Error> {
    if let Some(txn) = load_transaction(root)? {
        return Ok(Some(txn.target_tag));
    }
    Ok(read_install_manifest(root).ok().map(|m| m.release_tag))
}

fn command_check(root: &Path) -> Result<Option<String>, Error> {
    if load_transaction(root)?.is_some() {
        return Err(Error::Conflict(
            "unfinished transaction requires recovery".into(),
        ));
    }
    let current = read_install_manifest(root).ok().map(|m| m.release_tag);
    let client = GitHubClient::new()?;
    let mut releases = client.releases()?;
    releases.sort_by_key(|release| {
        std::cmp::Reverse(matterviz_updater::parse_preview_tag(&release.tag_name).unwrap_or(0))
    });
    let registry = embedded_key_registry()?;
    let target = host_target()?;
    for release in releases.iter().filter(|release| {
        release.prerelease && is_newer_preview(&release.tag_name, current.as_deref())
    }) {
        let Some(asset) = release
            .assets
            .iter()
            .find(|asset| asset.name == matterviz_updater::RELEASE_MANIFEST_ASSET_NAME)
        else {
            continue;
        };
        if asset.size > matterviz_updater::MAX_JSON_BYTES as u64 {
            return Err(Error::Limit(
                "signed release manifest exceeds 64 KiB".into(),
            ));
        }
        let bytes = client.download_bounded(
            &asset.browser_download_url,
            matterviz_updater::MAX_JSON_BYTES as u64,
        )?;
        if bytes.len() as u64 != asset.size {
            return Err(Error::Network("signed manifest asset size mismatch".into()));
        }
        require_asset_digest(
            asset,
            &matterviz_updater::sha256_hex(&bytes),
            "signed manifest",
        )?;
        let signed: matterviz_updater::SignedReleaseManifest = serde_json::from_slice(&bytes)?;
        matterviz_updater::verify_signed_manifest(&signed, &registry)?;
        if signed.manifest.tag != release.tag_name {
            return Err(Error::Signature(
                "manifest tag differs from GitHub release tag".into(),
            ));
        }
        let Some(item) = signed
            .manifest
            .targets
            .iter()
            .find(|item| item.target == target)
        else {
            return Err(Error::Invalid(format!("release has no asset for {target}")));
        };
        let archive = release
            .assets
            .iter()
            .find(|archive| archive.name == item.archive_name)
            .ok_or_else(|| Error::Invalid("release archive missing".into()))?;
        if archive.size != item.archive_size {
            return Err(Error::Signature(
                "release archive size differs from signed target".into(),
            ));
        }
        require_asset_digest(archive, &item.archive_sha256, "release archive")?;
        clear_candidate(root)?;
        let candidate = CandidateState {
            install_root: root.display().to_string(),
            tag: signed.manifest.tag.clone(),
            target: target.clone(),
            archive_path: String::new(),
            archive_url: archive.browser_download_url.clone(),
            manifest: signed,
        };
        save_candidate(root, &candidate)?;
        return Ok(Some(release.tag_name.clone()));
    }
    clear_candidate(root)?;
    Ok(None)
}

fn require_asset_digest(
    asset: &matterviz_updater::RemoteAsset,
    expected: &str,
    label: &str,
) -> Result<(), Error> {
    if let Some(digest) = asset.digest.as_deref() {
        let digest = digest.strip_prefix("sha256:").unwrap_or(digest);
        if digest != expected {
            return Err(Error::Network(format!("GitHub {label} digest mismatch")));
        }
    }
    Ok(())
}

fn command_stage(root: &Path) -> Result<Option<String>, Error> {
    let candidate =
        load_candidate(root)?.ok_or_else(|| Error::Invalid("run check before stage".into()))?;
    let registry = embedded_key_registry()?;
    matterviz_updater::verify_signed_manifest(&candidate.manifest, &registry)?;
    if candidate.manifest.manifest.tag != candidate.tag {
        return Err(Error::Signature("candidate tag mismatch".into()));
    }
    let target = candidate
        .manifest
        .manifest
        .targets
        .iter()
        .find(|t| t.target == candidate.target)
        .ok_or_else(|| Error::Invalid("candidate target missing".into()))?;
    let bytes = if candidate.archive_path.is_empty() {
        GitHubClient::new()?.download(&candidate.archive_url)?
    } else {
        fs::read(&candidate.archive_path)?
    };
    if bytes.len() as u64 != target.archive_size {
        return Err(Error::Signature("staged archive size mismatch".into()));
    }
    if matterviz_updater::sha256_hex(&bytes) != target.archive_sha256 {
        return Err(Error::Signature("staged archive digest mismatch".into()));
    }
    let dir = stage_dir(root);
    if let Ok(meta) = fs::symlink_metadata(&dir) {
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err(Error::Invalid("candidate stage is not a directory".into()));
        }
        fs::remove_dir_all(&dir)?;
    }
    let result = (|| {
        let m = extract_archive(&bytes, &dir)?;
        matterviz_updater::authenticate_target_inventory(&dir, &m, &registry)?;
        if matterviz_updater::manifest_sha256(&m)? != target.install_manifest_sha256 {
            return Err(Error::Signature("install manifest digest mismatch".into()));
        }
        Ok::<(), Error>(())
    })();
    match result {
        Ok(()) => {}
        Err(error) => {
            let _ = fs::remove_dir_all(&dir);
            return Err(error);
        }
    };
    Ok(Some(candidate.tag))
}

#[cfg(unix)]
#[allow(unsafe_code)]
fn configure_detached_command(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

#[cfg(windows)]
fn configure_detached_command(command: &mut Command, breakaway: bool) {
    use std::os::windows::process::CommandExt;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    let mut flags = CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS;
    if breakaway {
        flags |= CREATE_BREAKAWAY_FROM_JOB;
    }
    command.creation_flags(flags);
}

fn spawn_detached(path: &std::path::Path, args: &[&str]) -> io::Result<()> {
    let mut command = Command::new(path);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        configure_detached_command(&mut command);
        command.spawn().map(|_| ())
    }
    #[cfg(windows)]
    {
        configure_detached_command(&mut command, true);
        match command.spawn() {
            Ok(_) => Ok(()),
            Err(first) => {
                let mut fallback = Command::new(path);
                fallback
                    .args(args)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());
                configure_detached_command(&mut fallback, false);
                fallback.spawn().map(|_| ()).map_err(|second| {
                    io::Error::new(
                        second.kind(),
                        format!("detached spawn failed ({first}); fallback failed ({second})"),
                    )
                })
            }
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (path, args);
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "detached process spawn is unsupported",
        ))
    }
}

fn command_install(root: &Path, args: &[String]) -> Result<Option<String>, Error> {
    let host = parse_pid(args, "--host-pid")?;
    let multiwfn = parse_pid(args, "--multiwfn-pid")?;
    if host == 0 || multiwfn == 0 {
        return Err(Error::Invalid(
            "both --host-pid and --multiwfn-pid are required".into(),
        ));
    }
    let candidate =
        load_candidate(root)?.ok_or_else(|| Error::Invalid("run check before install".into()))?;
    let staged = stage_dir(root);
    if !staged.is_dir() {
        return Err(Error::Invalid("run stage before install".into()));
    }
    let candidate_dir = candidate_dir(root);
    fs::create_dir_all(&candidate_dir)?;
    let helper_name = if cfg!(windows) {
        "multiwfn-matterviz-updater-helper.exe"
    } else {
        "multiwfn-matterviz-updater-helper"
    };
    let helper = candidate_dir.join(helper_name);
    if let Ok(meta) = fs::symlink_metadata(&helper) {
        if meta.file_type().is_symlink() || !meta.is_file() {
            return Err(Error::Invalid(
                "candidate helper is not a regular file".into(),
            ));
        }
        fs::remove_file(&helper)?;
    }
    fs::copy(env::current_exe().map_err(Error::Io)?, &helper)?;
    let host_arg = host.to_string();
    let multiwfn_arg = multiwfn.to_string();
    spawn_detached(
        &helper,
        &[
            "--helper",
            "--host-pid",
            &host_arg,
            "--multiwfn-pid",
            &multiwfn_arg,
        ],
    )
    .map_err(Error::Io)?;
    Ok(Some(candidate.tag))
}

fn command_helper(args: &[String]) -> Result<(), Error> {
    if args.iter().any(|arg| arg == "--install-root") {
        return Err(Error::Invalid(
            "helper install root is derived from candidate state".into(),
        ));
    }
    let exe = env::current_exe()
        .map_err(Error::Io)?
        .canonicalize()
        .map_err(Error::Io)?;
    let expected_name = if cfg!(windows) {
        "multiwfn-matterviz-updater-helper.exe"
    } else {
        "multiwfn-matterviz-updater-helper"
    };
    if exe.file_name().and_then(|name| name.to_str()) != Some(expected_name) {
        return Err(Error::Invalid(
            "helper path is not an updater helper".into(),
        ));
    }
    let helper_parent = exe
        .parent()
        .ok_or_else(|| Error::Invalid("helper has no candidate parent".into()))?
        .canonicalize()
        .map_err(Error::Io)?;
    let candidate_file = helper_parent.join("candidate.json");
    let candidate_bytes = fs::read(&candidate_file)?;
    if candidate_bytes.len() > matterviz_updater::MAX_JSON_BYTES {
        return Err(Error::Limit("candidate state exceeds 64 KiB".into()));
    }
    let candidate: CandidateState = serde_json::from_slice(&candidate_bytes)?;
    if candidate.install_root.is_empty() {
        return Err(Error::Invalid("candidate has no install root".into()));
    }
    let root = PathBuf::from(&candidate.install_root);
    if candidate_dir(&root).canonicalize().map_err(Error::Io)? != helper_parent {
        return Err(Error::Invalid("helper is not the candidate sibling".into()));
    }
    if candidate.tag != candidate.manifest.manifest.tag {
        return Err(Error::Signature("candidate tag mismatch".into()));
    }
    if candidate.target != host_target()? {
        return Err(Error::Signature(
            "candidate target does not match this host".into(),
        ));
    }
    let registry = embedded_key_registry()?;
    matterviz_updater::verify_signed_manifest(&candidate.manifest, &registry)?;
    let target = candidate
        .manifest
        .manifest
        .targets
        .iter()
        .find(|target| target.target == candidate.target)
        .ok_or_else(|| Error::Signature("candidate target is not signed".into()))?;
    let candidate_loaded = load_candidate(&root)?
        .ok_or_else(|| Error::Invalid("candidate state is missing".into()))?;
    if candidate_loaded != candidate {
        return Err(Error::Invalid(
            "candidate state changed while launching helper".into(),
        ));
    }
    if load_transaction(&root)?.is_some() {
        return Err(Error::Conflict(
            "unfinished transaction requires recovery".into(),
        ));
    }
    let host = parse_pid(args, "--host-pid")?;
    let multiwfn = parse_pid(args, "--multiwfn-pid")?;
    if host == 0 || multiwfn == 0 {
        return Err(Error::Invalid("both process IDs are required".into()));
    }
    wait_for_processes(host, multiwfn)?;
    let staged = stage_dir(&root);
    let stage_meta = fs::symlink_metadata(&staged).map_err(Error::Io)?;
    if !stage_meta.is_dir() || stage_meta.file_type().is_symlink() {
        return Err(Error::Invalid("candidate stage is not a directory".into()));
    }
    let m = read_install_manifest(&staged)?;
    if m.release_tag != candidate.tag
        || m.target != candidate.target
        || matterviz_updater::manifest_sha256(&m)? != target.install_manifest_sha256
    {
        return Err(Error::Signature(
            "staged inventory does not match candidate release".into(),
        ));
    }
    let current = read_install_manifest(&root)?;
    if !is_newer_preview(&m.release_tag, Some(&current.release_tag)) {
        return Err(Error::Conflict(
            "candidate release is not newer than installed release".into(),
        ));
    }
    let signed = matterviz_updater::read_inventory_proof(&root)?;
    apply_authenticated_transaction(&root, &staged, &m, &signed, &registry)?;
    Ok(())
}

fn parse_pid(args: &[String], flag: &str) -> Result<u32, Error> {
    args.windows(2)
        .find(|p| p[0] == flag)
        .map(|p| {
            p[1].parse()
                .map_err(|_| Error::Invalid(format!("invalid {flag}")))
        })
        .unwrap_or(Ok(0))
}
#[cfg(all(unix, not(target_os = "linux")))]
#[allow(unsafe_code)]
fn unix_process_alive(pid: u32) -> bool {
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(target_os = "linux")]
#[allow(unsafe_code)]
fn wait_for_processes_linux(host: u32, multiwfn: u32) -> Result<(), Error> {
    use std::os::unix::io::RawFd;
    fn open_pidfd(pid: u32) -> Result<Option<RawFd>, Error> {
        let fd =
            unsafe { libc::syscall(libc::SYS_pidfd_open, pid as libc::c_uint, 0) } as libc::c_int;
        if fd >= 0 {
            return Ok(Some(fd));
        }
        let error = io::Error::last_os_error();
        match error.raw_os_error() {
            Some(libc::ESRCH) => Ok(None),
            Some(libc::ENOSYS) => Err(Error::Network("Linux pidfd_open is unavailable".into())),
            _ => Err(Error::Io(error)),
        }
    }
    let mut fds = Vec::new();
    for pid in [host, multiwfn] {
        match open_pidfd(pid) {
            Ok(Some(fd)) => fds.push(fd),
            Ok(None) => {}
            Err(error) => {
                for fd in fds {
                    unsafe {
                        libc::close(fd);
                    }
                }
                return Err(error);
            }
        }
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);
    while !fds.is_empty() {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            for fd in fds {
                unsafe {
                    libc::close(fd);
                }
            }
            return Err(Error::Network(
                "timed out waiting for host processes".into(),
            ));
        }
        let timeout = remaining.as_millis().min(1_000) as libc::c_int;
        let mut pollfds: Vec<libc::pollfd> = fds
            .iter()
            .map(|fd| libc::pollfd {
                fd: *fd,
                events: libc::POLLIN,
                revents: 0,
            })
            .collect();
        let polled =
            unsafe { libc::poll(pollfds.as_mut_ptr(), pollfds.len() as libc::nfds_t, timeout) };
        if polled < 0 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::Interrupted {
                continue;
            }
            for fd in fds {
                unsafe {
                    libc::close(fd);
                }
            }
            return Err(Error::Io(error));
        }
        if polled == 0 {
            continue;
        }
        let mut remaining_fds = Vec::with_capacity(fds.len());
        for (fd, pollfd) in fds.into_iter().zip(pollfds) {
            if pollfd.revents & (libc::POLLIN | libc::POLLHUP | libc::POLLERR | libc::POLLNVAL) != 0
            {
                unsafe {
                    libc::close(fd);
                }
            } else {
                remaining_fds.push(fd);
            }
        }
        fds = remaining_fds;
    }
    Ok(())
}

#[cfg(all(unix, not(target_os = "linux")))]
fn wait_for_processes_unix(host: u32, multiwfn: u32) -> Result<(), Error> {
    let start = std::time::Instant::now();
    while start.elapsed() < std::time::Duration::from_secs(300) {
        if !unix_process_alive(host) && !unix_process_alive(multiwfn) {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Err(Error::Network(
        "timed out waiting for host processes".into(),
    ))
}

#[cfg(windows)]
#[allow(unsafe_code)]
fn wait_for_processes_windows(host: u32, multiwfn: u32) -> Result<(), Error> {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, WAIT_FAILED, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const WAIT_TIMEOUT: u32 = 0x102;
    let started = std::time::Instant::now();
    let mut handles = Vec::new();
    for pid in [host, multiwfn] {
        let handle =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, pid) };
        if handle.is_null() {
            if unsafe { GetLastError() } != 87 {
                for existing in handles {
                    unsafe {
                        CloseHandle(existing);
                    }
                }
                return Err(Error::Network("could not open host process".into()));
            }
        } else {
            handles.push(handle);
        }
    }
    for (index, handle) in handles.iter().enumerate() {
        let remaining = std::time::Duration::from_secs(300).saturating_sub(started.elapsed());
        let result = unsafe {
            WaitForSingleObject(*handle, remaining.as_millis().min(u32::MAX as u128) as u32)
        };
        let mut exit_code = 0u32;
        let queried = unsafe { GetExitCodeProcess(*handle, &mut exit_code) } != 0;
        unsafe {
            CloseHandle(*handle);
        }
        if result == WAIT_TIMEOUT {
            for remaining_handle in handles.iter().skip(index + 1) {
                unsafe {
                    CloseHandle(*remaining_handle);
                }
            }
            return Err(Error::Network(
                "timed out waiting for host processes".into(),
            ));
        }
        if result == WAIT_FAILED || result != WAIT_OBJECT_0 || !queried {
            for remaining_handle in handles.iter().skip(index + 1) {
                unsafe {
                    CloseHandle(*remaining_handle);
                }
            }
            return Err(Error::Network("failed waiting for host process".into()));
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn wait_for_processes(host: u32, multiwfn: u32) -> Result<(), Error> {
    wait_for_processes_linux(host, multiwfn)
}
#[cfg(all(unix, not(target_os = "linux")))]
fn wait_for_processes(host: u32, multiwfn: u32) -> Result<(), Error> {
    wait_for_processes_unix(host, multiwfn)
}
#[cfg(windows)]
fn wait_for_processes(host: u32, multiwfn: u32) -> Result<(), Error> {
    wait_for_processes_windows(host, multiwfn)
}
#[cfg(not(any(unix, windows)))]
fn wait_for_processes(_host: u32, _multiwfn: u32) -> Result<(), Error> {
    Err(Error::Network("unsupported platform process wait".into()))
}
fn host_target() -> Result<String, Error> {
    target_for(env::consts::OS, env::consts::ARCH)
}

fn target_for(os: &str, arch: &str) -> Result<String, Error> {
    let target = match (os, arch) {
        ("windows", "x86_64") => "windows-x86_64",
        ("macos", "aarch64") => "macos-aarch64",
        ("macos", "x86_64") => "macos-x86_64",
        ("linux", "aarch64") => "linux-aarch64",
        ("linux", "x86_64") => "linux-x86_64",
        (os, arch) => {
            return Err(Error::Invalid(format!(
                "unsupported updater platform {os}-{arch}"
            )))
        }
    };
    Ok(target.into())
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.iter().any(|a| a == "--helper") {
        if let Err(error) = command_helper(&args) {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    let root = install_root();
    let command = args.get(1).map(String::as_str).unwrap_or("status");
    let code = match command {
        "status" => reply(command, &root, command_status(&root)),
        "check" => reply(command, &root, command_check(&root)),
        "stage" => reply(command, &root, command_stage(&root)),
        "install" => reply(command, &root, command_install(&root, &args)),
        "confirm" => reply(command, &root, confirm_transaction(&root).map(|_| None)),
        "rollback-last" => reply(command, &root, rollback_last(&root).map(|_| None)),
        _ => reply(
            command,
            &root,
            Err(Error::Invalid("unknown command".into())),
        ),
    };
    std::process::exit(code);
}

fn bound_message(message: &str) -> String {
    message
        .chars()
        .take(matterviz_updater::MAX_MESSAGE_BYTES)
        .collect()
}
fn conflict_list(error: &Error) -> Vec<String> {
    if let Error::Conflict(message) = error {
        vec![bound_message(message)]
    } else {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::{target_for, wait_for_processes};

    #[test]
    fn rejects_unsupported_platforms() {
        assert!(target_for("linux", "riscv64").is_err());
        assert!(target_for("freebsd", "x86_64").is_err());
    }

    #[test]
    fn native_process_wait_accepts_already_absent_processes() {
        wait_for_processes(2_147_483_647, 2_147_483_647).unwrap();
    }
}
