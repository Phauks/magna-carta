//! The supervisor-to-worker pipe protocol: length-prefixed JSON over the child's standard input
//! and output.
//!
//! **Document bytes never cross this pipe.** LibreOfficeKit is path-based — it loads a document
//! URL and saves to one — so the supervisor materialises each job as a directory on the container
//! disk and sends paths. The pipe carries a job manifest and a result, nothing more. That is what
//! keeps a five-hundred-megabyte document off the supervisor's heap and out of a pipe buffer.
//!
//! Both an async (supervisor) and a blocking (worker child) codec live here, over one frame
//! format, so the two ends can never drift apart.

use std::io::{Read, Write};

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// The largest frame either end will read. Manifests and results are a few hundred bytes; anything
/// approaching this is a desynchronised stream or a confused child, and reading it would be an
/// unbounded allocation driven by whatever the other end wrote.
pub const MAX_FRAME_BYTES: u32 = 1024 * 1024;

/// What a job package asks the worker to do. The entry document and the output document are names
/// relative to the package directory, never absolute paths, so the manifest is portable and a
/// worker can never be pointed outside the directory the supervisor created for it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobManifest {
    /// The document to load, relative to the package directory.
    pub entry_document: String,
    /// The format token for LibreOfficeKit's `save_as`.
    pub save_format: String,
    /// The LibreOffice filter name for that save.
    pub filter: String,
    /// Where to write the result, relative to the package directory.
    pub output_document: String,
    /// How the email render path wants attachments handled. Absent for every conversion this
    /// container serves today; carried on the manifest from the start so the render slice adds a
    /// dispatch arm rather than a new job shape.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachment_policy: Option<String>,
}

/// Supervisor to worker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SupervisorFrame {
    /// Convert the package rooted at `package_directory`.
    #[serde(rename_all = "camelCase")]
    Convert {
        package_directory: String,
        manifest: JobManifest,
    },
    /// Finish and exit. Sent on an orderly retire; a wedged worker gets a signal instead.
    Shutdown,
}

/// Why a document that reached the suite could not be converted. Each of these is a deterministic
/// fact about the document, not a transient fault, so each maps to 422 rather than a retry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnconvertibleCode {
    /// The suite asked for a password. We never attempt one: an encrypted document is a
    /// deterministic fact, the same stance the scan engine takes.
    PasswordProtected,
    /// The document did not load at all.
    LoadFailed,
    /// The document loaded but the save through the requested filter failed.
    SaveFailed,
    /// The save reported success and produced nothing. Reported as a document fault rather than a
    /// success, because a caller about to file something cannot be left unable to tell an empty
    /// document from a failed conversion.
    EmptyOutput,
}

/// Worker to supervisor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WorkerFrame {
    /// LibreOfficeKit finished initialising and this worker can convert. Sent exactly once, before
    /// any job is accepted — this frame is what makes the container's `/ready` honest.
    #[serde(rename_all = "camelCase")]
    Ready { suite_version: String },
    /// The conversion succeeded and the output document is on disk where the manifest said.
    #[serde(rename_all = "camelCase")]
    Converted {
        /// The worker's own view of its resident set. The supervisor prefers the kernel's figure
        /// where it can read one and takes the larger of the two, so a worker that under-reports
        /// cannot dodge the recycle ceiling.
        resident_kibibytes: u64,
    },
    /// The document reached the suite and could not be converted.
    #[serde(rename_all = "camelCase")]
    Unconvertible { code: UnconvertibleCode },
}

/// A framing or transport failure on the pipe. Every variant means the worker is no longer
/// trustworthy, so the supervisor's response to all of them is identical: kill the child, return a
/// retryable status, and start a replacement.
#[derive(Debug)]
pub enum FrameError {
    /// The pipe closed. Usually the child died.
    Closed,
    /// The frame header declared a length beyond [`MAX_FRAME_BYTES`].
    Oversize(u32),
    /// The frame body was not the JSON this protocol defines.
    Malformed,
    /// The underlying pipe failed.
    Transport(std::io::Error),
}

impl std::fmt::Display for FrameError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FrameError::Closed => write!(formatter, "worker pipe closed"),
            FrameError::Oversize(length) => {
                write!(formatter, "worker frame of {length} bytes exceeds the cap")
            }
            FrameError::Malformed => write!(formatter, "worker frame was not well-formed"),
            FrameError::Transport(error) => {
                write!(formatter, "worker pipe transport failure: {error}")
            }
        }
    }
}

impl std::error::Error for FrameError {}

fn encode<T: Serialize>(frame: &T) -> Result<Vec<u8>, FrameError> {
    let body = serde_json::to_vec(frame).map_err(|_| FrameError::Malformed)?;
    let length = u32::try_from(body.len()).map_err(|_| FrameError::Oversize(u32::MAX))?;
    if length > MAX_FRAME_BYTES {
        return Err(FrameError::Oversize(length));
    }
    let mut framed = Vec::with_capacity(body.len() + 4);
    framed.extend_from_slice(&length.to_be_bytes());
    framed.extend_from_slice(&body);
    Ok(framed)
}

fn decode<T: for<'de> Deserialize<'de>>(body: &[u8]) -> Result<T, FrameError> {
    serde_json::from_slice(body).map_err(|_| FrameError::Malformed)
}

/// Write one frame to an async pipe and flush it. Flushing is not optional: the peer is blocked on
/// a read, so a buffered frame is a deadlock that presents as the conversion deadline.
pub async fn write_frame<W, T>(writer: &mut W, frame: &T) -> Result<(), FrameError>
where
    W: AsyncWrite + Unpin,
    T: Serialize,
{
    let framed = encode(frame)?;
    writer
        .write_all(&framed)
        .await
        .map_err(FrameError::Transport)?;
    writer.flush().await.map_err(FrameError::Transport)
}

/// Read one frame from an async pipe. A clean end-of-file is [`FrameError::Closed`] rather than a
/// transport error, because the ordinary way a worker stops answering is by dying.
pub async fn read_frame<R, T>(reader: &mut R) -> Result<T, FrameError>
where
    R: AsyncRead + Unpin,
    T: for<'de> Deserialize<'de>,
{
    let mut header = [0u8; 4];
    match reader.read_exact(&mut header).await {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
            return Err(FrameError::Closed)
        }
        Err(error) => return Err(FrameError::Transport(error)),
    }
    let length = u32::from_be_bytes(header);
    if length > MAX_FRAME_BYTES {
        return Err(FrameError::Oversize(length));
    }
    let mut body = vec![0u8; length as usize];
    match reader.read_exact(&mut body).await {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
            return Err(FrameError::Closed)
        }
        Err(error) => return Err(FrameError::Transport(error)),
    }
    decode(&body)
}

/// Write one frame to a blocking pipe. The worker child runs without an async runtime — it is
/// single-threaded by construction, because LibreOfficeKit is — so it uses this end of the codec.
pub fn write_frame_blocking<W: Write, T: Serialize>(
    writer: &mut W,
    frame: &T,
) -> Result<(), FrameError> {
    let framed = encode(frame)?;
    writer.write_all(&framed).map_err(FrameError::Transport)?;
    writer.flush().map_err(FrameError::Transport)
}

/// Read one frame from a blocking pipe.
pub fn read_frame_blocking<R: Read, T: for<'de> Deserialize<'de>>(
    reader: &mut R,
) -> Result<T, FrameError> {
    let mut header = [0u8; 4];
    match reader.read_exact(&mut header) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
            return Err(FrameError::Closed)
        }
        Err(error) => return Err(FrameError::Transport(error)),
    }
    let length = u32::from_be_bytes(header);
    if length > MAX_FRAME_BYTES {
        return Err(FrameError::Oversize(length));
    }
    let mut body = vec![0u8; length as usize];
    match reader.read_exact(&mut body) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
            return Err(FrameError::Closed)
        }
        Err(error) => return Err(FrameError::Transport(error)),
    }
    decode(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> JobManifest {
        JobManifest {
            entry_document: "source.docx".to_owned(),
            save_format: "pdf".to_owned(),
            filter: "writer_pdf_Export".to_owned(),
            output_document: "output.pdf".to_owned(),
            attachment_policy: None,
        }
    }

    #[test]
    fn a_frame_round_trips_through_the_blocking_codec() {
        let frame = SupervisorFrame::Convert {
            package_directory: "/var/spool/job-1".to_owned(),
            manifest: manifest(),
        };
        let mut pipe: Vec<u8> = Vec::new();
        write_frame_blocking(&mut pipe, &frame).unwrap();
        let decoded: SupervisorFrame = read_frame_blocking(&mut pipe.as_slice()).unwrap();
        assert_eq!(decoded, frame);
    }

    #[tokio::test]
    async fn a_frame_round_trips_through_the_async_codec() {
        let frame = WorkerFrame::Converted {
            resident_kibibytes: 320_000,
        };
        let mut pipe: Vec<u8> = Vec::new();
        write_frame(&mut pipe, &frame).await.unwrap();
        let decoded: WorkerFrame = read_frame(&mut pipe.as_slice()).await.unwrap();
        assert_eq!(decoded, frame);
    }

    #[tokio::test]
    async fn the_two_codecs_agree_on_the_wire_format() {
        // A frame written by the blocking end must be readable by the async end and the reverse;
        // the worker and the supervisor are the two ends of exactly this pipe.
        let frame = WorkerFrame::Ready {
            suite_version: "25.8".to_owned(),
        };
        let mut pipe: Vec<u8> = Vec::new();
        write_frame_blocking(&mut pipe, &frame).unwrap();
        let decoded: WorkerFrame = read_frame(&mut pipe.as_slice()).await.unwrap();
        assert_eq!(decoded, frame);
    }

    #[tokio::test]
    async fn a_closed_pipe_reads_as_closed_not_as_a_transport_error() {
        let empty: Vec<u8> = Vec::new();
        let error = read_frame::<_, WorkerFrame>(&mut empty.as_slice())
            .await
            .unwrap_err();
        assert!(matches!(error, FrameError::Closed));
    }

    #[tokio::test]
    async fn a_truncated_body_reads_as_closed() {
        let mut pipe = 64u32.to_be_bytes().to_vec();
        pipe.extend_from_slice(b"{}");
        let error = read_frame::<_, WorkerFrame>(&mut pipe.as_slice())
            .await
            .unwrap_err();
        assert!(matches!(error, FrameError::Closed));
    }

    #[tokio::test]
    async fn an_oversize_header_is_refused_before_the_allocation() {
        let pipe = (MAX_FRAME_BYTES + 1).to_be_bytes().to_vec();
        let error = read_frame::<_, WorkerFrame>(&mut pipe.as_slice())
            .await
            .unwrap_err();
        assert!(matches!(error, FrameError::Oversize(_)));
    }

    #[tokio::test]
    async fn a_body_that_is_not_this_protocol_is_malformed() {
        let body = b"not json at all";
        let mut pipe = (body.len() as u32).to_be_bytes().to_vec();
        pipe.extend_from_slice(body);
        let error = read_frame::<_, WorkerFrame>(&mut pipe.as_slice())
            .await
            .unwrap_err();
        assert!(matches!(error, FrameError::Malformed));
    }

    #[test]
    fn the_attachment_policy_is_absent_rather_than_null_when_unset() {
        let encoded = serde_json::to_string(&manifest()).unwrap();
        assert!(!encoded.contains("attachmentPolicy"));
    }

    #[test]
    fn a_manifest_carrying_an_attachment_policy_round_trips() {
        let mut with_policy = manifest();
        with_policy.attachment_policy = Some("append-as-trailing-pages".to_owned());
        let encoded = serde_json::to_string(&with_policy).unwrap();
        let decoded: JobManifest = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, with_policy);
    }
}
