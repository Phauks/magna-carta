//! A worker test double.
//!
//! It speaks the same pipe protocol as the real worker and can be instructed to hang, exit
//! non-zero, abort on a signal, report a runaway resident set, emit a malformed frame, or produce
//! no output. That is what lets the supervisor's state machine — where the risk in this engine
//! actually lives — be proved by `cargo test` on any machine, with no LibreOffice installed and no
//! Docker daemon running.
//!
//! The container image never copies this binary.

use std::io::{stdin, stdout, BufReader, BufWriter, Write};
use std::path::Path;
use std::time::Duration;

use magna_carta_libreoffice::protocol::{
    read_frame_blocking, write_frame_blocking, FrameError, SupervisorFrame, UnconvertibleCode,
    WorkerFrame,
};

#[derive(Debug, Clone, PartialEq, Eq)]
enum Behaviour {
    /// Write the output document and report success.
    Convert,
    /// Read the job and never answer. The supervisor's conversion deadline is what ends this.
    Hang,
    /// Exit with a status code, mid-job.
    Exit(u8),
    /// Die on a signal, mid-job.
    Abort,
    /// Answer with something that is not this protocol.
    Garbage,
    /// Report success and write nothing.
    EmptyOutput,
    /// Report the document as unconvertible.
    Unconvertible(UnconvertibleCode),
}

struct Options {
    ready_delay: Duration,
    never_ready: bool,
    suite_version: String,
    resident_kibibytes: u64,
    behaviour: Behaviour,
    /// The one-based job number at which `behaviour` starts applying. Jobs before it convert
    /// normally, so a test can drive a worker through healthy work and then fault it.
    behaviour_from_job: u32,
    /// Delay before answering each job, so a test can hold a worker busy deterministically.
    job_delay: Duration,
}

fn parse_options() -> Options {
    let mut options = Options {
        ready_delay: Duration::ZERO,
        never_ready: false,
        suite_version: "LibreOffice 25.8 (fake)".to_owned(),
        resident_kibibytes: 0,
        behaviour: Behaviour::Convert,
        behaviour_from_job: 1,
        job_delay: Duration::ZERO,
    };
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let mut index = 0;
    while index < arguments.len() {
        let flag = arguments[index].clone();
        // Every flag but `--never-ready` takes exactly one value, so read it once up front rather
        // than threading a borrow of the argument list through the match arms.
        let value = arguments.get(index + 1).cloned().unwrap_or_default();
        match flag.as_str() {
            "--ready-delay-ms" => {
                index += 1;
                options.ready_delay = Duration::from_millis(value.parse().unwrap_or(0));
            }
            "--never-ready" => options.never_ready = true,
            "--suite-version" => {
                index += 1;
                options.suite_version = value;
            }
            "--resident-kibibytes" => {
                index += 1;
                options.resident_kibibytes = value.parse().unwrap_or(0);
            }
            "--job-delay-ms" => {
                index += 1;
                options.job_delay = Duration::from_millis(value.parse().unwrap_or(0));
            }
            "--behaviour-from-job" => {
                index += 1;
                options.behaviour_from_job = value.parse().unwrap_or(1);
            }
            "--behaviour" => {
                index += 1;
                let specification = value;
                options.behaviour = match specification.split_once(':') {
                    Some(("exit", code)) => Behaviour::Exit(code.parse().unwrap_or(1)),
                    Some(("unconvertible", code)) => Behaviour::Unconvertible(match code {
                        "password-protected" => UnconvertibleCode::PasswordProtected,
                        "save-failed" => UnconvertibleCode::SaveFailed,
                        "empty-output" => UnconvertibleCode::EmptyOutput,
                        _ => UnconvertibleCode::LoadFailed,
                    }),
                    _ => match specification.as_str() {
                        "hang" => Behaviour::Hang,
                        "abort" => Behaviour::Abort,
                        "garbage" => Behaviour::Garbage,
                        "empty-output" => Behaviour::EmptyOutput,
                        _ => Behaviour::Convert,
                    },
                };
            }
            _ => {}
        }
        index += 1;
    }
    options
}

fn main() -> std::process::ExitCode {
    let options = parse_options();
    let mut output = BufWriter::new(stdout());
    let mut input = BufReader::new(stdin());

    if options.never_ready {
        // Stand still with the pipe open. The supervisor's warm deadline is what ends this, and it
        // must end it without the pool ever counting this process as able to convert.
        loop {
            std::thread::sleep(Duration::from_secs(3600));
        }
    }

    if !options.ready_delay.is_zero() {
        std::thread::sleep(options.ready_delay);
    }
    if write_frame_blocking(
        &mut output,
        &WorkerFrame::Ready {
            suite_version: options.suite_version.clone(),
        },
    )
    .is_err()
    {
        return std::process::ExitCode::from(3);
    }

    let mut job_number: u32 = 0;
    loop {
        let frame: SupervisorFrame = match read_frame_blocking(&mut input) {
            Ok(frame) => frame,
            Err(FrameError::Closed) => return std::process::ExitCode::SUCCESS,
            Err(_) => return std::process::ExitCode::from(4),
        };
        let SupervisorFrame::Convert {
            package_directory,
            manifest,
        } = frame
        else {
            return std::process::ExitCode::SUCCESS;
        };

        job_number += 1;
        if !options.job_delay.is_zero() {
            std::thread::sleep(options.job_delay);
        }

        let behaviour = if job_number >= options.behaviour_from_job {
            options.behaviour.clone()
        } else {
            Behaviour::Convert
        };

        let response = match behaviour {
            Behaviour::Hang => loop {
                std::thread::sleep(Duration::from_secs(3600));
            },
            Behaviour::Exit(code) => return std::process::ExitCode::from(code),
            Behaviour::Abort => std::process::abort(),
            Behaviour::Garbage => {
                // A well-framed body that is not this protocol: the supervisor must treat it as a
                // fault it can recover from, never as a hang or a silent success.
                let body = b"{\"kind\":\"somethingElse\"}";
                let mut framed = (body.len() as u32).to_be_bytes().to_vec();
                framed.extend_from_slice(body);
                if output.write_all(&framed).is_err() || output.flush().is_err() {
                    return std::process::ExitCode::from(3);
                }
                continue;
            }
            Behaviour::EmptyOutput => WorkerFrame::Converted {
                resident_kibibytes: options.resident_kibibytes,
            },
            Behaviour::Unconvertible(code) => WorkerFrame::Unconvertible { code },
            Behaviour::Convert => {
                let path = Path::new(&package_directory).join(&manifest.output_document);
                let bytes: &[u8] = if manifest.output_document.ends_with(".pdf") {
                    b"%PDF-1.7\n% fake conversion output\n%%EOF\n"
                } else {
                    b"PK\x03\x04 fake conversion output"
                };
                if std::fs::write(path, bytes).is_err() {
                    WorkerFrame::Unconvertible {
                        code: UnconvertibleCode::SaveFailed,
                    }
                } else {
                    WorkerFrame::Converted {
                        resident_kibibytes: options.resident_kibibytes,
                    }
                }
            }
        };

        if write_frame_blocking(&mut output, &response).is_err() {
            return std::process::ExitCode::from(3);
        }
    }
}
