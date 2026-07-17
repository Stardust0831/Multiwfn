//! Ownership boundary for pipe endpoints inherited from the Multiwfn launcher.

use std::fs::File;
use std::io;

#[cfg(unix)]
pub fn adopt(raw: u64) -> io::Result<File> {
    use std::os::fd::{AsRawFd, FromRawFd, RawFd};

    let fd = RawFd::try_from(raw).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "inherited pipe descriptor is too large",
        )
    })?;
    // SAFETY: the launcher transfers ownership of this inherited descriptor.
    let file = unsafe { File::from_raw_fd(fd) };
    let flags = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETFD) };
    if flags < 0
        || unsafe { libc::fcntl(file.as_raw_fd(), libc::F_SETFD, flags | libc::FD_CLOEXEC) } < 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(file)
}

#[cfg(windows)]
pub fn adopt(raw: u64) -> io::Result<File> {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, RawHandle};
    use windows_sys::Win32::Foundation::{SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT};

    let raw = usize::try_from(raw).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "inherited pipe handle is too large",
        )
    })?;
    if raw == 0 || raw == usize::MAX {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "inherited pipe handle is invalid",
        ));
    }
    // SAFETY: the launcher transfers ownership of this inherited handle.
    let file = unsafe { File::from_raw_handle(raw as RawHandle) };
    let changed =
        unsafe { SetHandleInformation(file.as_raw_handle() as HANDLE, HANDLE_FLAG_INHERIT, 0) };
    if changed == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(file)
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;
    use std::os::windows::io::{FromRawHandle, RawHandle};
    use windows_sys::Win32::Foundation::{
        GetHandleInformation, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT,
    };
    use windows_sys::Win32::System::Pipes::CreatePipe;

    #[test]
    fn adopted_handle_is_not_inheritable() {
        let mut read: HANDLE = std::ptr::null_mut();
        let mut write: HANDLE = std::ptr::null_mut();
        assert_ne!(
            unsafe { CreatePipe(&mut read, &mut write, std::ptr::null(), 0) },
            0
        );
        let _write = unsafe { File::from_raw_handle(write as RawHandle) };
        assert_ne!(
            unsafe { SetHandleInformation(read, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) },
            0
        );

        let _read = adopt(read as usize as u64).unwrap();
        let mut flags = 0_u32;
        assert_ne!(unsafe { GetHandleInformation(read, &mut flags) }, 0);
        assert_eq!(flags & HANDLE_FLAG_INHERIT, 0);
    }
}
