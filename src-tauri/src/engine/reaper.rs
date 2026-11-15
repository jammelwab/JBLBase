//! Makes sure engine child processes never outlive the app.
//!
//! Engines (Stockfish, Patricia, …) are separate processes. Dropping a
//! `BaseEngine` kills its process, but destructors do not run when the app
//! leaves through `std::process::exit` (e.g. the Windows updater, which starts
//! the installer and exits right away), on a crash, or when the process is
//! killed from the task manager. The engines then keep running and burn CPU.
//!
//! * Windows: every engine is put into a Job Object with
//!   `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. The job handle belongs to the app
//!   process, so whenever the app process ends — for whatever reason — the OS
//!   closes the handle and terminates every engine in the job. Only engines are
//!   assigned, so the update installer is not affected.
//! * Everywhere: engine PIDs are tracked and `kill_all` terminates all of them
//!   explicitly on exit, restart and before an update is installed.

use std::{collections::HashSet, sync::Mutex};

use once_cell::sync::Lazy;
use tokio::process::Child;

static ENGINE_PIDS: Lazy<Mutex<HashSet<u32>>> = Lazy::new(|| Mutex::new(HashSet::new()));

/// Registers a freshly spawned engine process.
pub fn register(child: &Child) {
    #[cfg(target_os = "windows")]
    windows::assign_to_job(child);

    if let Some(pid) = child.id() {
        if let Ok(mut pids) = ENGINE_PIDS.lock() {
            pids.insert(pid);
        }
    }
}

/// Forgets an engine process that has been killed or has exited.
pub fn unregister(pid: Option<u32>) {
    if let Some(pid) = pid {
        if let Ok(mut pids) = ENGINE_PIDS.lock() {
            pids.remove(&pid);
        }
    }
}

/// Number of engine processes that are currently tracked.
#[allow(dead_code)]
pub fn count() -> usize {
    ENGINE_PIDS.lock().map(|p| p.len()).unwrap_or(0)
}

/// Terminates every engine process immediately. Safe to call more than once.
pub fn kill_all() {
    let pids: Vec<u32> = match ENGINE_PIDS.lock() {
        Ok(mut pids) => pids.drain().collect(),
        Err(_) => Vec::new(),
    };

    #[cfg(target_os = "windows")]
    windows::terminate_job();

    for pid in &pids {
        kill_pid(*pid);
    }

    if !pids.is_empty() {
        log::info!("Stopped {} engine process(es)", pids.len());
    }
}

#[cfg(unix)]
fn kill_pid(pid: u32) {
    // SAFETY: plain syscall; a stale PID at worst yields ESRCH.
    unsafe {
        libc::kill(pid as libc::pid_t, libc::SIGKILL);
    }
}

#[cfg(target_os = "windows")]
fn kill_pid(pid: u32) {
    windows::terminate_pid(pid);
}

#[cfg(not(any(unix, target_os = "windows")))]
fn kill_pid(_pid: u32) {}

#[cfg(target_os = "windows")]
mod windows {
    use std::{ffi::c_void, mem, ptr, sync::OnceLock};

    use tokio::process::Child;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
            Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE},
        },
    };

    /// Job handle stored as usize so it can live in a static.
    /// It is intentionally never closed: the OS closes it when the app process
    /// ends, which is exactly what triggers KILL_ON_JOB_CLOSE.
    static JOB: OnceLock<Option<usize>> = OnceLock::new();

    fn job() -> Option<HANDLE> {
        let job = JOB.get_or_init(|| unsafe {
            let job = CreateJobObjectW(ptr::null(), ptr::null());
            if job.is_null() {
                log::error!("Could not create engine job object");
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const c_void,
                mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                log::error!("Could not configure engine job object");
                CloseHandle(job);
                return None;
            }
            Some(job as usize)
        });
        job.map(|h| h as HANDLE)
    }

    pub fn assign_to_job(child: &Child) {
        let (Some(job), Some(handle)) = (job(), child.raw_handle()) else {
            return;
        };
        let ok = unsafe { AssignProcessToJobObject(job, handle as HANDLE) };
        if ok == 0 {
            log::error!(
                "Could not assign engine to job object: {}",
                std::io::Error::last_os_error()
            );
        }
    }

    pub fn terminate_job() {
        if let Some(job) = JOB.get().copied().flatten() {
            unsafe {
                TerminateJobObject(job as HANDLE, 1);
            }
        }
    }

    pub fn terminate_pid(pid: u32) {
        unsafe {
            let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if !handle.is_null() {
                TerminateProcess(handle, 1);
                CloseHandle(handle);
            }
        }
    }
}
