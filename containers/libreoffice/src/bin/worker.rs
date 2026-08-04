//! The worker child: the only binary in this repository that loads LibreOffice.
//!
//! It initialises LibreOfficeKit exactly once at start-up and then serves conversions one at a time
//! for the rest of its life. There is no async runtime here and no second thread: the suite's office
//! handle is neither `Send` nor `Sync`, and a second concurrent instance in one process segfaults,
//! so single-threaded is a correctness property rather than a simplification.
//!
//! There is also no teardown-and-rebuild path. Creating an instance after destroying one segfaults
//! too, which is why the supervisor recycles by replacing this whole process.

use std::cell::Cell;
use std::io::{stdin, stdout, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::rc::Rc;

use libreofficekit::{CallbackType, DocUrl, Office, OfficeOptionalFeatures};
use magna_carta_libreoffice::protocol::{
    read_frame_blocking, write_frame_blocking, FrameError, JobManifest, SupervisorFrame,
    UnconvertibleCode, WorkerFrame,
};
use magna_carta_libreoffice::resident::resident_kibibytes;

/// Encourage the suite to give memory back after each conversion. A large positive target asks for
/// immediate maximum saving; this is the cheap first line, and it often avoids a replacement that
/// the resident-set ceiling would otherwise force.
const TRIM_MEMORY_TARGET: i32 = 2000;

fn main() -> std::process::ExitCode {
    let mut output = BufWriter::new(stdout());
    let mut input = BufReader::new(stdin());

    let office = match initialise() {
        Ok(office) => office,
        Err(reason) => {
            eprintln!("libreoffice worker: initialisation failed: {reason}");
            // Exiting non-zero without ever emitting a readiness frame is exactly what the
            // supervisor's warm path expects of a worker that cannot convert; it will not be
            // counted as ready and the container's /ready stays honest.
            return std::process::ExitCode::from(2);
        }
    };

    let version = office
        .office
        .get_version_info()
        .map(|info| format!("{} {}", info.product_name, info.product_version))
        .unwrap_or_else(|_| "unknown".to_owned());

    if write_frame_blocking(
        &mut output,
        &WorkerFrame::Ready {
            suite_version: version,
        },
    )
    .is_err()
    {
        return std::process::ExitCode::from(3);
    }

    loop {
        let frame: SupervisorFrame = match read_frame_blocking(&mut input) {
            Ok(frame) => frame,
            // The supervisor went away. Nothing to report to; exit quietly.
            Err(FrameError::Closed) => return std::process::ExitCode::SUCCESS,
            Err(reason) => {
                eprintln!("libreoffice worker: protocol failure: {reason}");
                return std::process::ExitCode::from(4);
            }
        };

        let response = match frame {
            SupervisorFrame::Shutdown => return std::process::ExitCode::SUCCESS,
            SupervisorFrame::Convert {
                package_directory,
                manifest,
            } => convert(&office, Path::new(&package_directory), &manifest),
        };

        if write_frame_blocking(&mut output, &response).is_err() {
            return std::process::ExitCode::from(3);
        }
        let _ = output.flush();
    }
}

/// The office handle plus the password-request flag its callback sets.
struct WorkerOffice {
    office: Office,
    password_requested: Rc<Cell<bool>>,
}

fn initialise() -> Result<WorkerOffice, String> {
    let install_path = resolve_install_path().ok_or_else(|| {
        "no LibreOffice installation found under /opt or the usual paths".to_owned()
    })?;
    let office = Office::new(install_path).map_err(|error| error.to_string())?;

    let password_requested = Rc::new(Cell::new(false));

    // Asking to be told about password prompts is what lets an encrypted document be reported as
    // password-protected rather than as an indistinguishable load failure. We never supply a
    // password: answering `None` ends the prompt loop and fails the load deterministically.
    office
        .set_optional_features(
            OfficeOptionalFeatures::DOCUMENT_PASSWORD
                | OfficeOptionalFeatures::DOCUMENT_PASSWORD_TO_MODIFY,
        )
        .map_err(|error| error.to_string())?;

    let flag = Rc::clone(&password_requested);
    office
        .register_callback(move |callback_office, callback_type, payload| {
            if !matches!(
                callback_type,
                CallbackType::DocumentPassword | CallbackType::DocumentPasswordModify
            ) {
                return;
            }
            flag.set(true);
            // The payload is the document URL the suite is asking about. Answering `None` for it
            // tells the suite the password is unknown, which ends the prompt rather than looping.
            if payload.is_null() {
                return;
            }
            let url = unsafe { std::ffi::CStr::from_ptr(payload) };
            let Ok(url) = url.to_str() else { return };
            let Ok(document_url) = DocUrl::from_remote_uri(url) else {
                return;
            };
            let _ = callback_office.set_document_password(&document_url, None);
        })
        .map_err(|error| error.to_string())?;

    Ok(WorkerOffice {
        office,
        password_requested,
    })
}

/// Where the suite lives. The image installs it under `/opt`, which is exactly the layout the
/// binding's `/opt` search expects; the environment variable is the escape hatch for a developer
/// running the worker against a system install.
fn resolve_install_path() -> Option<PathBuf> {
    if let Some(configured) = std::env::var_os("LOK_PROGRAM_PATH") {
        let path = PathBuf::from(configured);
        if path.exists() {
            return Some(path);
        }
    }
    Office::find_install_path()
}

fn convert(office: &WorkerOffice, package_directory: &Path, manifest: &JobManifest) -> WorkerFrame {
    let source = package_directory.join(&manifest.entry_document);
    let output = package_directory.join(&manifest.output_document);

    let Ok(source_url) = DocUrl::from_path(&source) else {
        return unconvertible(UnconvertibleCode::LoadFailed);
    };
    let Ok(output_url) = DocUrl::from_path(&output) else {
        return unconvertible(UnconvertibleCode::SaveFailed);
    };

    office.password_requested.set(false);
    let mut document = match office.office.document_load(&source_url) {
        Ok(document) => document,
        Err(_) => {
            let code = if office.password_requested.get() {
                UnconvertibleCode::PasswordProtected
            } else {
                UnconvertibleCode::LoadFailed
            };
            return unconvertible(code);
        }
    };

    let saved = document.save_as(
        &output_url,
        &manifest.save_format,
        Some(manifest.filter.as_str()),
    );
    // Drop the document before trimming so the suite can actually release what it held for it.
    drop(document);

    if !matches!(saved, Ok(true)) {
        let _ = office.office.trim_memory(TRIM_MEMORY_TARGET);
        return unconvertible(UnconvertibleCode::SaveFailed);
    }

    let _ = office.office.trim_memory(TRIM_MEMORY_TARGET);

    // A save that reports success and writes nothing is a fault, not a result. Reporting it as an
    // empty conversion would hand the caller a file they cannot tell apart from a real one.
    match std::fs::metadata(&output) {
        Ok(metadata) if metadata.len() > 0 => WorkerFrame::Converted {
            resident_kibibytes: resident_kibibytes(std::process::id()).unwrap_or(0),
        },
        _ => unconvertible(UnconvertibleCode::EmptyOutput),
    }
}

fn unconvertible(code: UnconvertibleCode) -> WorkerFrame {
    WorkerFrame::Unconvertible { code }
}
