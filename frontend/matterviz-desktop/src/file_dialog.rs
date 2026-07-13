use std::io;
use std::path::{Path, PathBuf};

pub fn select_file(_output: &Path) -> io::Result<Option<PathBuf>> {
    Ok(rfd::FileDialog::new().pick_file())
}
