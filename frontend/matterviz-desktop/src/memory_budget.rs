use std::env;

#[cfg(target_os = "linux")]
use std::path::{Path, PathBuf};

const MIB: u64 = 1024 * 1024;
const GIB: u64 = 1024 * MIB;
const MIN_RESERVE_BYTES: u64 = 2 * GIB;
const RESERVE_PERCENT: u64 = 20;
const LIMIT_ENV: &str = "MULTIWFN_MATTERVIZ_MAX_ACTIVE_VOLUME_BYTES";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MemorySnapshot {
    pub total_bytes: u64,
    pub available_bytes: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MemoryBudget {
    pub available_bytes: u64,
    pub reserve_bytes: u64,
    pub active_limit_bytes: u64,
}

pub fn active_volume_budget(current_active_bytes: u64) -> Result<MemoryBudget, String> {
    let snapshot = memory_snapshot()?;
    let configured = env::var(LIMIT_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(|value| parse_byte_limit(&value))
        .transpose()?;
    Ok(calculate_budget(snapshot, current_active_bytes, configured))
}

fn calculate_budget(
    snapshot: MemorySnapshot,
    current_active_bytes: u64,
    configured_limit: Option<u64>,
) -> MemoryBudget {
    let reserve_bytes = MIN_RESERVE_BYTES.max(
        snapshot
            .total_bytes
            .saturating_mul(RESERVE_PERCENT)
            .saturating_div(100),
    );
    let automatic = snapshot
        .available_bytes
        .saturating_sub(reserve_bytes)
        .saturating_add(current_active_bytes);
    let active_limit_bytes = configured_limit
        .map(|limit| limit.min(automatic))
        .unwrap_or(automatic);
    MemoryBudget {
        available_bytes: snapshot.available_bytes,
        reserve_bytes,
        active_limit_bytes,
    }
}

fn parse_byte_limit(value: &str) -> Result<u64, String> {
    let normalized = value.trim().to_ascii_lowercase().replace('_', "");
    let (number, multiplier) = if let Some(number) = normalized.strip_suffix("gib") {
        (number, GIB)
    } else if let Some(number) = normalized.strip_suffix("mib") {
        (number, MIB)
    } else if let Some(number) = normalized.strip_suffix("gb") {
        (number, 1_000_000_000)
    } else if let Some(number) = normalized.strip_suffix("mb") {
        (number, 1_000_000)
    } else {
        (normalized.as_str(), 1)
    };
    let parsed = number.trim().parse::<u64>().map_err(|_| {
        format!("{LIMIT_ENV} must be a positive byte count, optionally suffixed MiB or GiB")
    })?;
    if parsed == 0 {
        return Err(format!("{LIMIT_ENV} must be greater than zero"));
    }
    parsed
        .checked_mul(multiplier)
        .ok_or_else(|| format!("{LIMIT_ENV} exceeds the supported byte range"))
}

#[cfg(target_os = "linux")]
fn memory_snapshot() -> Result<MemorySnapshot, String> {
    let meminfo = std::fs::read_to_string("/proc/meminfo")
        .map_err(|error| format!("could not read /proc/meminfo: {error}"))?;
    let value = |name: &str| -> Option<u64> {
        meminfo.lines().find_map(|line| {
            let (key, rest) = line.split_once(':')?;
            (key == name).then(|| {
                rest.split_whitespace()
                    .next()
                    .and_then(|number| number.parse::<u64>().ok())
                    .and_then(|kib| kib.checked_mul(1024))
            })?
        })
    };
    let total_bytes = value("MemTotal").ok_or("MemTotal is missing from /proc/meminfo")?;
    let host_available =
        value("MemAvailable").ok_or("MemAvailable is missing from /proc/meminfo")?;
    let (total_bytes, available_bytes) = linux_cgroup_available(total_bytes, host_available)
        .unwrap_or((total_bytes, host_available));
    Ok(MemorySnapshot {
        total_bytes,
        available_bytes: available_bytes.min(total_bytes),
    })
}

#[cfg(target_os = "linux")]
fn linux_cgroup_available(host_total: u64, host_available: u64) -> Option<(u64, u64)> {
    let cgroup = std::fs::read_to_string("/proc/self/cgroup").ok()?;
    let mountinfo = std::fs::read_to_string("/proc/self/mountinfo").ok()?;
    linux_cgroup_available_from_data(host_total, host_available, &cgroup, &mountinfo, |path| {
        std::fs::read_to_string(path).ok()
    })
}

#[cfg(target_os = "linux")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CgroupKind {
    V2,
    V1Memory,
}

#[cfg(target_os = "linux")]
#[derive(Clone, Debug, PartialEq, Eq)]
struct CgroupMembership {
    kind: CgroupKind,
    path: String,
}

#[cfg(target_os = "linux")]
#[derive(Clone, Debug, PartialEq, Eq)]
struct CgroupMount {
    kind: CgroupKind,
    root: String,
    mount_point: String,
}

#[cfg(target_os = "linux")]
#[derive(Clone, Debug, PartialEq, Eq)]
struct CgroupFiles {
    kind: CgroupKind,
    limit: PathBuf,
    usage: PathBuf,
}

#[cfg(target_os = "linux")]
fn linux_cgroup_available_from_data<F>(
    host_total: u64,
    host_available: u64,
    cgroup_text: &str,
    mountinfo_text: &str,
    read_file: F,
) -> Option<(u64, u64)>
where
    F: Fn(&Path) -> Option<String>,
{
    let mut effective_total = host_total;
    let mut effective_available = host_available;
    let mut found_limit = false;
    for files in resolve_cgroup_files(cgroup_text, mountinfo_text) {
        let Some(limit_text) = read_file(&files.limit) else {
            continue;
        };
        let limit_text = limit_text.trim();
        let limit = match files.kind {
            CgroupKind::V2 if limit_text == "max" => continue,
            CgroupKind::V2 | CgroupKind::V1Memory => {
                let Ok(limit) = limit_text.parse::<u64>() else {
                    continue;
                };
                if files.kind == CgroupKind::V1Memory && is_v1_unlimited_limit(limit) {
                    continue;
                }
                limit
            }
        };
        let Some(usage_text) = read_file(&files.usage) else {
            continue;
        };
        let Ok(usage) = usage_text.trim().parse::<u64>() else {
            continue;
        };
        found_limit = true;
        effective_total = effective_total.min(limit);
        effective_available = effective_available.min(limit.saturating_sub(usage));
    }
    found_limit.then_some((effective_total, effective_available))
}

#[cfg(target_os = "linux")]
fn is_v1_unlimited_limit(limit: u64) -> bool {
    // The kernel's cgroup v1 memory controller uses LONG_MAX rounded down to
    // a page boundary for its "unlimited" value. Accept larger sentinels too.
    limit >= 0x7fff_ffff_ffff_f000
}

#[cfg(target_os = "linux")]
fn resolve_cgroup_files(cgroup_text: &str, mountinfo_text: &str) -> Vec<CgroupFiles> {
    let memberships = parse_cgroup_memberships(cgroup_text);
    let mounts = parse_cgroup_mounts(mountinfo_text);
    let mut files = Vec::new();
    for membership in memberships {
        for mount in mounts.iter().filter(|mount| mount.kind == membership.kind) {
            let Some(bases) = cgroup_mount_paths(mount, &membership.path) else {
                continue;
            };
            let (limit_name, usage_name) = match membership.kind {
                CgroupKind::V2 => ("memory.max", "memory.current"),
                CgroupKind::V1Memory => ("memory.limit_in_bytes", "memory.usage_in_bytes"),
            };
            files.extend(bases.into_iter().map(|base| CgroupFiles {
                kind: membership.kind,
                limit: base.join(limit_name),
                usage: base.join(usage_name),
            }));
        }
    }
    files
}

#[cfg(target_os = "linux")]
fn parse_cgroup_memberships(text: &str) -> Vec<CgroupMembership> {
    text.lines()
        .filter_map(|line| {
            let line = line.trim();
            let mut fields = line.splitn(3, ':');
            let hierarchy = fields.next()?;
            let controllers = fields.next()?;
            let path = fields.next()?.trim();
            if path.is_empty() || path.split('/').any(|part| part == "..") {
                return None;
            }
            if hierarchy == "0" && controllers.is_empty() {
                Some(CgroupMembership {
                    kind: CgroupKind::V2,
                    path: path.to_owned(),
                })
            } else if controllers.split(',').any(|controller| controller == "memory") {
                Some(CgroupMembership {
                    kind: CgroupKind::V1Memory,
                    path: path.to_owned(),
                })
            } else {
                None
            }
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn parse_cgroup_mounts(text: &str) -> Vec<CgroupMount> {
    text.lines()
        .filter_map(|line| {
            let (mount_fields, filesystem_fields) = line.split_once(" - ")?;
            let mount_fields: Vec<_> = mount_fields.split_whitespace().collect();
            let filesystem_fields: Vec<_> = filesystem_fields.split_whitespace().collect();
            if mount_fields.len() < 6 || filesystem_fields.is_empty() {
                return None;
            }
            let root = decode_mountinfo_path(mount_fields[3]);
            let mount_point = decode_mountinfo_path(mount_fields[4]);
            if !is_valid_mountinfo_path(&root) || !is_valid_mountinfo_path(&mount_point) {
                return None;
            }
            let filesystem = filesystem_fields[0];
            if filesystem == "cgroup2" {
                return Some(CgroupMount {
                    kind: CgroupKind::V2,
                    root,
                    mount_point,
                });
            }
            if filesystem != "cgroup" {
                return None;
            }
            let mut options = mount_fields[5].split(',').chain(
                filesystem_fields
                    .get(2)
                    .into_iter()
                    .flat_map(|value| value.split(',')),
            );
            options
                .any(|option| option == "memory")
                .then_some(CgroupMount {
                    kind: CgroupKind::V1Memory,
                    root,
                    mount_point,
                })
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn is_valid_mountinfo_path(path: &str) -> bool {
    Path::new(path).is_absolute() && !path.split('/').any(|part| part == "..")
}

#[cfg(target_os = "linux")]
fn decode_mountinfo_path(path: &str) -> String {
    path.replace("\\040", " ")
        .replace("\\011", "\t")
        .replace("\\012", "\n")
        .replace("\\134", "\\")
}

#[cfg(all(target_os = "linux", test))]
fn cgroup_mount_path(mount: &CgroupMount, cgroup_path: &str) -> Option<PathBuf> {
    cgroup_mount_paths(mount, cgroup_path)?.into_iter().next()
}

#[cfg(target_os = "linux")]
fn cgroup_mount_paths(mount: &CgroupMount, cgroup_path: &str) -> Option<Vec<PathBuf>> {
    let path = cgroup_path.trim();
    if path.is_empty() || path.split('/').any(|part| part == "..") {
        return None;
    }
    let root = mount.root.trim_matches('/');
    let path = path.trim_matches('/');
    let relative = if root.is_empty() {
        path
    } else if path == root {
        ""
    } else if let Some(suffix) = path
        .strip_prefix(root)
        .and_then(|suffix| suffix.strip_prefix('/'))
    {
        suffix
    } else {
        // In a cgroup namespace /proc/self/cgroup is relative to the
        // namespace root, while mountinfo's root is relative to the host
        // hierarchy. In that case the path is already mount-relative.
        path
    };
    let segments: Vec<_> = relative.split('/').filter(|segment| !segment.is_empty()).collect();
    let mut paths = Vec::with_capacity(segments.len() + 1);
    for count in (0..=segments.len()).rev() {
        let mut resolved = PathBuf::from(&mount.mount_point);
        for segment in &segments[..count] {
            resolved.push(*segment);
        }
        paths.push(resolved);
    }
    Some(paths)
}

#[cfg(target_os = "windows")]
fn memory_snapshot() -> Result<MemorySnapshot, String> {
    use std::mem::size_of;
    use windows_sys::Win32::System::SystemInformation::{
        GlobalMemoryStatusEx, MEMORYSTATUSEX,
    };

    let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    status.dwLength = size_of::<MEMORYSTATUSEX>() as u32;
    if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(MemorySnapshot {
        total_bytes: status.ullTotalPhys,
        available_bytes: status.ullAvailPhys,
    })
}

#[cfg(target_os = "macos")]
fn memory_snapshot() -> Result<MemorySnapshot, String> {
    let total_bytes = macos_sysctl_u64("hw.memsize")?;
    let page_size = macos_sysctl_u64("hw.pagesize")?;
    let free_pages = macos_sysctl_u64("vm.page_free_count")?;
    let inactive_pages = macos_sysctl_u64("vm.page_inactive_count").unwrap_or(0);
    let purgeable_pages = macos_sysctl_u64("vm.page_purgeable_count").unwrap_or(0);
    let available_bytes = free_pages
        .saturating_add(inactive_pages)
        .saturating_add(purgeable_pages)
        .saturating_mul(page_size)
        .min(total_bytes);
    Ok(MemorySnapshot {
        total_bytes,
        available_bytes,
    })
}

#[cfg(target_os = "macos")]
fn macos_sysctl_u64(name: &str) -> Result<u64, String> {
    use std::ffi::CString;

    let name = CString::new(name).map_err(|error| error.to_string())?;
    let mut value = 0_u64;
    let mut length = std::mem::size_of::<u64>();
    let status = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            (&mut value as *mut u64).cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    };
    if status != 0 || length == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(value)
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn memory_snapshot() -> Result<MemorySnapshot, String> {
    Err("MatterViz memory admission is unsupported on this platform".to_owned())
}

#[cfg(test)]
mod tests {
    use super::{calculate_budget, parse_byte_limit, MemorySnapshot, GIB, MIB};

    #[cfg(target_os = "linux")]
    use super::{
        cgroup_mount_path, linux_cgroup_available_from_data, parse_cgroup_mounts,
        resolve_cgroup_files, CgroupKind,
    };
    #[cfg(target_os = "linux")]
    use std::collections::HashMap;
    #[cfg(target_os = "linux")]
    use std::path::Path;

    #[test]
    fn automatic_budget_reserves_system_memory_and_reuses_active_bytes() {
        let budget = calculate_budget(
            MemorySnapshot {
                total_bytes: 16 * GIB,
                available_bytes: 10 * GIB,
            },
            512 * MIB,
            None,
        );
        assert_eq!(budget.reserve_bytes, 16 * GIB / 5);
        assert_eq!(budget.active_limit_bytes, 10 * GIB - 16 * GIB / 5 + 512 * MIB);
    }

    #[test]
    fn configured_limit_can_only_tighten_the_automatic_budget() {
        let snapshot = MemorySnapshot {
            total_bytes: 8 * GIB,
            available_bytes: 6 * GIB,
        };
        assert_eq!(
            calculate_budget(snapshot, 0, Some(GIB)).active_limit_bytes,
            GIB
        );
        assert_eq!(
            calculate_budget(snapshot, 0, Some(32 * GIB)).active_limit_bytes,
            4 * GIB
        );
    }

    #[test]
    fn parses_plain_and_human_readable_byte_limits() {
        assert_eq!(parse_byte_limit("1048576").unwrap(), MIB);
        assert_eq!(parse_byte_limit("512 MiB").unwrap(), 512 * MIB);
        assert_eq!(parse_byte_limit("4_GiB").unwrap(), 4 * GIB);
        assert!(parse_byte_limit("0").is_err());
        assert!(parse_byte_limit("many").is_err());
    }

    #[test]
    fn sub_two_gibibyte_hosts_reserve_all_currently_available_memory() {
        let budget = calculate_budget(
            MemorySnapshot {
                total_bytes: GIB,
                available_bytes: 768 * MIB,
            },
            0,
            None,
        );
        assert_eq!(budget.reserve_bytes, 2 * GIB);
        assert_eq!(budget.active_limit_bytes, 0);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn resolves_v2_leaf_files_from_process_membership() {
        let files = resolve_cgroup_files(
            "0::/user.slice/user-1000.slice/session-2.scope\n",
            "36 29 0:32 / /sys/fs/cgroup rw,nosuid,nodev - cgroup2 cgroup rw\n",
        );
        assert_eq!(files.len(), 4);
        assert_eq!(files[0].kind, CgroupKind::V2);
        assert_eq!(
            files[0].limit,
            Path::new(
                "/sys/fs/cgroup/user.slice/user-1000.slice/session-2.scope/memory.max",
            )
        );
        assert_eq!(
            files[0].usage,
            Path::new(
                "/sys/fs/cgroup/user.slice/user-1000.slice/session-2.scope/memory.current",
            )
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn resolves_v1_memory_controller_leaf_files() {
        let files = resolve_cgroup_files(
            "5:cpu,memory:/docker/container-1\n",
            concat!(
                "30 20 0:25 / /sys/fs/cgroup/memory rw,relatime ",
                "- cgroup cgroup rw,memory\n",
            ),
        );
        assert_eq!(files.len(), 3);
        assert_eq!(files[0].kind, CgroupKind::V1Memory);
        assert_eq!(
            files[0].limit,
            Path::new(
                "/sys/fs/cgroup/memory/docker/container-1/memory.limit_in_bytes",
            )
        );
        assert_eq!(
            files[0].usage,
            Path::new(
                "/sys/fs/cgroup/memory/docker/container-1/memory.usage_in_bytes",
            )
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn maps_mount_root_to_a_namespace_relative_cgroup_path() {
        let mounts = parse_cgroup_mounts(
            concat!(
                "30 20 0:25 /docker/container-1 /run/cgroup/memory rw,relatime ",
                "- cgroup cgroup rw,memory\n",
            ),
        );
        assert_eq!(mounts.len(), 1);
        assert_eq!(
            cgroup_mount_path(&mounts[0], "/docker/container-1/worker"),
            Some(std::path::PathBuf::from("/run/cgroup/memory/worker"))
        );
        assert_eq!(
            cgroup_mount_path(&mounts[0], "/worker"),
            Some(std::path::PathBuf::from("/run/cgroup/memory/worker"))
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn ignores_unlimited_and_malformed_cgroup_limits() {
        let paths = HashMap::from([
            ("/sys/fs/cgroup/leaf/memory.max", "max"),
            ("/sys/fs/cgroup/leaf/memory.current", "1"),
            (
                "/sys/fs/cgroup/memory/leaf/memory.limit_in_bytes",
                "9223372036854771712",
            ),
            (
                "/sys/fs/cgroup/memory/leaf/memory.usage_in_bytes",
                "1",
            ),
        ]);
        let result = linux_cgroup_available_from_data(
            16 * GIB,
            8 * GIB,
            "0::/leaf\n5:memory:/leaf\n",
            concat!(
                "36 29 0:32 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
                "30 20 0:25 / /sys/fs/cgroup/memory rw - cgroup cgroup rw,memory\n",
            ),
            |path| paths.get(path.to_str()?).map(|value| (*value).to_owned()),
        );
        assert_eq!(result, None);

        let malformed = linux_cgroup_available_from_data(
            16 * GIB,
            8 * GIB,
            "0::/leaf\n",
            "36 29 0:32 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
            |path| {
                (path == Path::new("/sys/fs/cgroup/leaf/memory.max"))
                    .then(|| "not-a-number".to_owned())
            },
        );
        assert_eq!(malformed, None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn constrains_available_memory_by_leaf_limit_minus_usage() {
        let paths = HashMap::from([
            ("/sys/fs/cgroup/leaf/memory.max", "4294967296"),
            ("/sys/fs/cgroup/leaf/memory.current", "1610612736"),
        ]);
        let result = linux_cgroup_available_from_data(
            16 * GIB,
            8 * GIB,
            "0::/leaf\n",
            "36 29 0:32 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
            |path| paths.get(path.to_str()?).map(|value| (*value).to_owned()),
        );
        assert_eq!(result, Some((4 * GIB, 5 * GIB / 2)));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn constrained_parent_applies_when_leaf_is_unlimited() {
        let paths = HashMap::from([
            ("/sys/fs/cgroup/a/b/memory.max", "max"),
            ("/sys/fs/cgroup/a/b/memory.current", "100"),
            ("/sys/fs/cgroup/a/memory.max", "4294967296"),
            ("/sys/fs/cgroup/a/memory.current", "1073741824"),
        ]);
        let result = linux_cgroup_available_from_data(
            16 * GIB,
            8 * GIB,
            "0::/a/b\n",
            "36 29 0:32 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
            |path| paths.get(path.to_str()?).map(|value| (*value).to_owned()),
        );
        assert_eq!(result, Some((4 * GIB, 3 * GIB)));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn chooses_tightest_available_constraint_across_ancestors() {
        let paths = HashMap::from([
            ("/sys/fs/cgroup/a/b/c/memory.max", "6442450944"),
            ("/sys/fs/cgroup/a/b/c/memory.current", "1073741824"),
            ("/sys/fs/cgroup/a/b/memory.max", "4294967296"),
            ("/sys/fs/cgroup/a/b/memory.current", "1073741824"),
            ("/sys/fs/cgroup/a/memory.max", "8589934592"),
            ("/sys/fs/cgroup/a/memory.current", "2147483648"),
            ("/sys/fs/cgroup/memory.max", "max"),
            ("/sys/fs/cgroup/memory.current", "1"),
        ]);
        let result = linux_cgroup_available_from_data(
            16 * GIB,
            8 * GIB,
            "0::/a/b/c\n",
            "36 29 0:32 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
            |path| paths.get(path.to_str()?).map(|value| (*value).to_owned()),
        );
        assert_eq!(result, Some((4 * GIB, 3 * GIB)));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn malformed_leaf_does_not_hide_a_valid_parent_constraint() {
        let paths = HashMap::from([
            ("/sys/fs/cgroup/a/b/memory.max", "not-a-number"),
            ("/sys/fs/cgroup/a/b/memory.current", "100"),
            ("/sys/fs/cgroup/a/memory.max", "4294967296"),
            ("/sys/fs/cgroup/a/memory.current", "1073741824"),
        ]);
        let result = linux_cgroup_available_from_data(
            16 * GIB,
            8 * GIB,
            "0::/a/b\n",
            "36 29 0:32 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
            |path| paths.get(path.to_str()?).map(|value| (*value).to_owned()),
        );
        assert_eq!(result, Some((4 * GIB, 3 * GIB)));
    }
}
