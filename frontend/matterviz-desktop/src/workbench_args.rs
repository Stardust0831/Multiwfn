use std::ffi::OsString;
use std::path::{Path, PathBuf};

#[derive(Debug, Default, PartialEq)]
pub struct WorkbenchArgs {
    pub script: Option<PathBuf>,
    pub startup: Option<PathBuf>,
}

pub fn is_script(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("bw") || value.eq_ignore_ascii_case("bwc"))
}

impl WorkbenchArgs {
    pub fn parse(args: impl IntoIterator<Item = OsString>) -> Result<Self, String> {
        let mut parsed = Self::default();
        let mut args = args.into_iter();
        let mut literal = false;
        while let Some(arg) = args.next() {
            if !literal && arg == "--" {
                literal = true;
                continue;
            }
            let (kind, path) = if !literal && (arg == "--script" || arg == "--wfn" || arg == "-w") {
                let path = args.next().ok_or("Missing file after --script or --wfn")?;
                (arg == "--script", PathBuf::from(path))
            } else {
                if !literal && arg.to_string_lossy().starts_with('-') {
                    return Err(format!(
                        "Unknown workbench option: {}",
                        arg.to_string_lossy()
                    ));
                }
                let path = PathBuf::from(arg);
                (is_script(&path), path)
            };
            if kind && !is_script(&path) {
                return Err("Workflow scripts must use .bw or .bwc".into());
            }
            let slot = if kind {
                &mut parsed.script
            } else {
                &mut parsed.startup
            };
            if slot.replace(path).is_some() {
                return Err("Specify at most one script and one startup file".into());
            }
        }
        Ok(parsed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parse(args: &[&str]) -> Result<WorkbenchArgs, String> {
        WorkbenchArgs::parse(args.iter().map(OsString::from))
    }
    #[test]
    fn opens_scripts_startup_files_and_explicit_pairs() {
        assert_eq!(parse(&[]).unwrap(), WorkbenchArgs::default());
        assert_eq!(
            parse(&["苯 file.fch"]).unwrap().startup,
            Some("苯 file.fch".into())
        );
        let args = parse(&["分析 script.BWC", "-w", "苯 file.fch"]).unwrap();
        assert_eq!(args.script, Some("分析 script.BWC".into()));
        assert_eq!(args.startup, Some("苯 file.fch".into()));
        assert_eq!(
            parse(&["--script", "x.bw"]).unwrap().script,
            Some("x.bw".into())
        );
        assert_eq!(
            parse(&["--", "-script.bw"]).unwrap().script,
            Some("-script.bw".into())
        );
        for args in [
            &["x.bw", "y.bwc"][..],
            &["--wfn"][..],
            &["--script", "x.fch"][..],
            &["--unknown"][..],
        ] {
            assert!(parse(args).is_err());
        }
    }
}
