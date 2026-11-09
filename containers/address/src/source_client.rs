//! OpenAddresses, reached through the intercepted source host.
//!
//! The build container has no internet. The address worker forwards exactly two shapes from
//! `openaddresses.magna-carta.internal` and refuses everything else (including any query string):
//!
//! - `GET /api/data` — the source list (`batch.openaddresses.io/api/data`).
//! - `GET /job/<digits>/source.geojson.gz` — one source's output, the worker following the redirect to
//!   the presigned object.
//!
//! Sources are decompressed as they stream, with `flate2`'s default `miniz_oxide` backend (pure Rust):
//! a statewide file is hundreds of megabytes compressed and is never held whole.

use std::fmt;
use std::io::{self, BufRead, BufReader, Read};
use std::time::Duration;

use flate2::read::MultiGzDecoder;
use serde::Deserialize;

/// The production source host.
pub const SOURCE_HOST: &str = "http://openaddresses.magna-carta.internal";

/// The source list is a few megabytes; anything past this is not a source list.
const LISTING_LIMIT: u64 = 64 * 1024 * 1024;
/// Waiting for the first byte of an answer.
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(120);
/// A whole source download, the largest statewide files included.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(3 * 60 * 60);

fn io_error(message: impl fmt::Display) -> io::Error {
    io::Error::other(message.to_string())
}

/// One entry of the source list. Only the fields the build reads; the rest are ignored.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct SourceListing {
    /// `us/nc/wake`.
    pub source: String,
    /// `addresses`, `buildings`, `parcels`, ...
    pub layer: String,
    /// The layer's name within the source: `county`, `city`, `statewide`, ...
    #[serde(default)]
    pub name: String,
    /// The job whose output is current. Absent for a source that has never run.
    #[serde(default)]
    pub job: Option<u64>,
}

#[derive(Clone)]
pub struct SourceClient {
    base_url: String,
    agent: ureq::Agent,
}

impl fmt::Debug for SourceClient {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SourceClient")
            .finish_non_exhaustive()
    }
}

impl SourceClient {
    /// `base_url` is the host's origin without a trailing slash: [`SOURCE_HOST`] in production.
    pub fn new(base_url: &str) -> Self {
        let agent = ureq::Agent::config_builder()
            .timeout_recv_response(Some(RESPONSE_TIMEOUT))
            .timeout_global(Some(DOWNLOAD_TIMEOUT))
            // The worker follows the presigned redirect itself; this side never talks to another host.
            .max_redirects(0)
            .http_status_as_error(false)
            .build()
            .into();
        Self {
            base_url: base_url.trim_end_matches('/').to_owned(),
            agent,
        }
    }

    /// The whole source list.
    pub fn list(&self) -> io::Result<Vec<SourceListing>> {
        let response = self
            .agent
            .get(&format!("{}/api/data", self.base_url))
            .call()
            .map_err(|error| io_error(format!("source list request failed: {error}")))?;
        let status = response.status().as_u16();
        if status != 200 {
            return Err(io_error(format!(
                "source list refused with status {status}"
            )));
        }
        let mut bytes = Vec::new();
        response
            .into_body()
            .into_reader()
            .take(LISTING_LIMIT)
            .read_to_end(&mut bytes)
            .map_err(|error| io_error(format!("source list was cut off: {error}")))?;
        serde_json::from_slice(&bytes).map_err(|_| io_error("source list is malformed"))
    }

    /// One job's output, decompressed as it is read.
    pub fn open(&self, job: u64) -> io::Result<impl BufRead> {
        let response = self
            .agent
            .get(&format!("{}/job/{job}/source.geojson.gz", self.base_url))
            .call()
            .map_err(|error| io_error(format!("source download failed: {error}")))?;
        let status = response.status().as_u16();
        if status != 200 {
            return Err(io_error(format!(
                "source download refused with status {status}"
            )));
        }
        let body = response.into_body().into_reader();
        Ok(BufReader::with_capacity(
            256 * 1024,
            MultiGzDecoder::new(BufReader::new(body)),
        ))
    }
}

/// The longest line a source may have. A feature is a few hundred bytes; a longer line is not one, and
/// is skipped rather than buffered without bound.
pub const MAXIMUM_LINE_BYTES: usize = 64 * 1024;

/// Read the next line into `line` (without its newline), skipping any line longer than
/// [`MAXIMUM_LINE_BYTES`]. `Ok(false)` at the end of the stream.
pub fn next_line(reader: &mut impl BufRead, line: &mut Vec<u8>) -> io::Result<bool> {
    loop {
        line.clear();
        let limit = MAXIMUM_LINE_BYTES as u64 + 1;
        let read = reader.by_ref().take(limit).read_until(b'\n', line)?;
        if read == 0 {
            return Ok(false);
        }
        if line.last() == Some(&b'\n') {
            line.pop();
            return Ok(true);
        }
        if line.len() <= MAXIMUM_LINE_BYTES {
            // The last line of the stream, without a newline.
            return Ok(true);
        }
        // Too long: discard the rest of it and try the next line.
        let mut rest = Vec::new();
        loop {
            rest.clear();
            let read = reader.by_ref().take(limit).read_until(b'\n', &mut rest)?;
            if read == 0 {
                return Ok(false);
            }
            if rest.last() == Some(&b'\n') {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_are_read_and_an_overlong_line_is_skipped() {
        let long = "x".repeat(MAXIMUM_LINE_BYTES * 3);
        let text = format!("first\n{long}\nsecond\nlast");
        let mut reader = BufReader::new(text.as_bytes());
        let mut line = Vec::new();
        let mut lines = Vec::new();
        while next_line(&mut reader, &mut line).unwrap() {
            lines.push(String::from_utf8(line.clone()).unwrap());
        }
        assert_eq!(lines, vec!["first", "second", "last"]);
    }

    #[test]
    fn a_listing_parses_with_unknown_fields_and_missing_jobs() {
        let listing: Vec<SourceListing> = serde_json::from_str(
            r#"[{"id":502,"source":"us/ak/anchorage","layer":"addresses","name":"county","job":916037,"output":{}},
                {"source":"us/nc/new","layer":"addresses","name":"city","job":null}]"#,
        )
        .unwrap();
        assert_eq!(listing[0].job, Some(916_037));
        assert_eq!(listing[1].job, None);
    }
}
