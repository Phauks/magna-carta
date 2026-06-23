use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

/// The clamd verdict for a buffer. `Unavailable` covers a socket/daemon error, a clamd `ERROR` reply, or
/// a non-UTF-8 reply — the verdict layer maps it to `unscanned` (never a silent `clean`).
#[derive(Debug, PartialEq, Eq)]
pub enum ClamVerdict {
    Clean,
    Infected(String),
    Unavailable,
}

/// The clamd endpoint inside the container image. clamd listens on loopback TCP only — no network egress
/// (the Container runs with `enableInternet = false`). Both the file-`SCAN` and the INSTREAM paths use
/// this same loopback socket; for `SCAN` the file path is just a string in the command.
pub const DEFAULT_CLAMD_ADDRESS: &str = "127.0.0.1:3310";

const INSTREAM_CHUNK_SIZE: usize = 1024 * 1024;
const INSTREAM_COMMAND: &[u8] = b"zINSTREAM\0";

// The deadline for the WHOLE clamd exchange — connect, the write loop, and the read — not the read
// alone: an unbounded INSTREAM write stalls forever under TCP backpressure if clamd wedges. It is sized
// for the LEGIT worst case, not a naive few seconds: a full-cap 2 GiB body at clamd's ~15 MiB/s scan
// floor is ~140s, and archive expansion (`MaxScanSize` is raised to the cap) can multiply the bytes
// clamd actually inspects, so the budget carries several minutes of headroom on top. Too tight here
// would false-positive a wedge on a large but legitimate upload and bounce it into a retry loop; on
// elapse the exchange returns `Unavailable`, which `combine()` maps to the retryable 503 (never clean),
// and the spooled scratch file drops — so a wedged daemon cannot leak a connection or a file.
//
// Overridable by `CLAMD_EXCHANGE_TIMEOUT_SECS` for operations (raise it for a slower DB / larger cap)
// and so a test can shrink it to drive the wedged-daemon path quickly.
const CLAMD_EXCHANGE_TIMEOUT_DEFAULT_SECS: u64 = 600;

fn exchange_timeout() -> Duration {
    std::env::var("CLAMD_EXCHANGE_TIMEOUT_SECS")
        .ok()
        .and_then(|value| value.parse().ok())
        .map(Duration::from_secs)
        .unwrap_or_else(|| Duration::from_secs(CLAMD_EXCHANGE_TIMEOUT_DEFAULT_SECS))
}

// A short, separate connect deadline: reaching loopback clamd is immediate when it is up, so a stalled
// connect is a dead/saturated daemon — fail fast to the retryable path rather than burn the full budget.
const CLAMD_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

// The clamd reply is one short line (`<source>: OK` / `<source>: <sig> FOUND` / `<source>: <msg> ERROR`).
// Cap the read so a wedged or hostile daemon streaming endless bytes cannot grow the reply buffer without
// bound; an over-cap reply is treated as unparseable and maps to `Unavailable`.
const MAX_REPLY_BYTES: u64 = 8 * 1024;

// Connects to clamd under the connect deadline, disabling Nagle. A connect timeout surfaces as an I/O
// error so the caller maps it to `Unavailable`.
async fn connect(clamd_address: &str) -> std::io::Result<TcpStream> {
    let stream = timeout(CLAMD_CONNECT_TIMEOUT, TcpStream::connect(clamd_address))
        .await
        .map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::TimedOut, "clamd connect timed out")
        })??;
    stream.set_nodelay(true)?;
    Ok(stream)
}

// Reads the clamd reply, bounded by `MAX_REPLY_BYTES` so an endless stream cannot grow the buffer.
async fn read_reply(stream: &mut TcpStream) -> std::io::Result<Vec<u8>> {
    let mut response = Vec::new();
    stream
        .take(MAX_REPLY_BYTES)
        .read_to_end(&mut response)
        .await?;
    Ok(response)
}

/// Scans a file clamd opens directly (`zSCAN <path>`) — the container transport. clamd reads the file
/// itself, avoiding INSTREAM's socket copy and its internal spool-to-temp-file, so it runs near
/// libclamav's native rate. The scan service writes the request body to this path (see `crate::spool`)
/// before calling, so the same file also backs the in-process engines' memory map.
#[cfg(unix)]
pub async fn scan_file_path(path: &std::path::Path, clamd_address: &str) -> ClamVerdict {
    match scan_file_path_inner(path, clamd_address).await {
        Ok(verdict) => verdict,
        Err(_) => ClamVerdict::Unavailable,
    }
}

#[cfg(unix)]
async fn scan_file_path_inner(
    path: &std::path::Path,
    clamd_address: &str,
) -> std::io::Result<ClamVerdict> {
    // The whole exchange (connect + command write + reply read) runs under one deadline so no leg can
    // hang the request indefinitely. On elapse the `Err` maps to `Unavailable` in `scan_file_path`.
    let response = timeout(exchange_timeout(), async {
        let mut stream = connect(clamd_address).await?;
        let command = format!("zSCAN {}\0", path.display());
        stream.write_all(command.as_bytes()).await?;
        read_reply(&mut stream).await
    })
    .await
    .map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "clamd scan exchange timed out",
        )
    })??;
    Ok(interpret_reply(&response))
}

/// Scans an in-memory buffer via INSTREAM over a `TCP_NODELAY` socket — the path on hosts without the
/// scratch-file transport (the Windows dev/test build, which has no real clamd). clamd reports
/// `Unavailable` on any socket/daemon error.
pub async fn scan_buffer(bytes: &[u8], clamd_address: &str) -> ClamVerdict {
    match instream_scan(bytes, clamd_address).await {
        Ok(response) => interpret_reply(&response),
        Err(_) => ClamVerdict::Unavailable,
    }
}

/// Streams a buffer to clamd via INSTREAM over a `TCP_NODELAY` socket and returns the raw reply. Driving
/// INSTREAM by hand lets us disable Nagle — the per-chunk 4-byte length prefix otherwise stalls
/// ~40-200 ms against clamd's delayed ACK, throttling large scans by ~8-13x on loopback.
async fn instream_scan(bytes: &[u8], clamd_address: &str) -> std::io::Result<Vec<u8>> {
    // Wrap the ENTIRE exchange, not just the read: the INSTREAM write loop is unbounded under TCP
    // backpressure, so a wedged clamd that stops draining the socket would hang the write forever if
    // only the read had a deadline. On elapse the `Err` maps to `Unavailable` in `scan_buffer`.
    timeout(exchange_timeout(), async {
        let mut stream = connect(clamd_address).await?;
        stream.write_all(INSTREAM_COMMAND).await?;
        for chunk in bytes.chunks(INSTREAM_CHUNK_SIZE) {
            stream
                .write_all(&(chunk.len() as u32).to_be_bytes())
                .await?;
            stream.write_all(chunk).await?;
        }
        stream.write_all(&0u32.to_be_bytes()).await?;
        read_reply(&mut stream).await
    })
    .await
    .map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "clamd instream exchange timed out",
        )
    })?
}

/// Interprets a clamd scan reply from either transport, RECORD BY RECORD. The `z`-protocol reply is one
/// or more NUL-terminated records, each `<source>: OK`, `<source>: <Signature> FOUND`, or `<source>:
/// <message> ERROR` (a path with multiple hits or an archive with multiple members yields several).
///
/// Precedence is structural so a FOUND can never be masked: ANY `FOUND` record ⇒ `Infected` (with the
/// first FOUND's signature); else ANY `ERROR` or unparseable/unexpected record ⇒ `Unavailable`; else
/// every record is `OK` ⇒ `Clean`. An empty reply, or a non-UTF-8 reply that does not decode to a clean
/// `OK`, has no `OK` record and so is `Unavailable` — NEVER silently `Clean`, so a file clamd did not
/// actually clear is never recorded as clean. (`from_utf8_lossy` maps invalid bytes to U+FFFD, which
/// cannot spell `OK`/`FOUND`, so a corrupted reply degrades to the unparseable ⇒ `Unavailable` path.)
fn interpret_reply(response: &[u8]) -> ClamVerdict {
    let text = String::from_utf8_lossy(response);
    let mut saw_ok = false;
    let mut unavailable = false;
    for record in text.split('\0') {
        let record = record.trim();
        if record.is_empty() {
            continue;
        }
        if record.ends_with("FOUND") {
            // A definitive hit wins immediately — never overridden by a later OK record.
            return ClamVerdict::Infected(parse_signature(record));
        } else if record.ends_with("OK") {
            saw_ok = true;
        } else {
            // An ERROR or any unrecognized record. Keep scanning for a FOUND (it must still win), but
            // remember that the reply was not all-clean.
            unavailable = true;
        }
    }
    if unavailable || !saw_ok {
        // An ERROR/unparseable record, or a reply with no OK at all (empty, source-only, truncated),
        // is a fault — never silently clean.
        ClamVerdict::Unavailable
    } else {
        ClamVerdict::Clean
    }
}

// Extracts the signature name from a `<source>: <Signature> FOUND` reply — the source prefix is `stream`
// for INSTREAM, or the scratch path for `SCAN`.
fn parse_signature(reply: &str) -> String {
    let body = reply.strip_suffix(" FOUND").unwrap_or(reply);
    body.rsplit_once(": ")
        .map(|(_, signature)| signature)
        .unwrap_or(body)
        .to_string()
}

/// Parses the clamd VERSION reply and extracts the signature-database version token.
///
/// clamd replies to `zVERSION\0` with a line like:
///
///   `ClamAV 1.0.3/27268/Thu Oct 12 09:31:47 2023`
///
/// The database version is the second `/`-delimited token (between the first and second `/`).
/// Returns `None` if the reply is missing, malformed, or non-UTF-8 — the caller treats that as a
/// startup failure (never a blank token that silently freezes the staleness gate).
pub fn parse_clamav_db_version(reply: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(reply).ok()?;
    // Strip any trailing null bytes or whitespace so a `z`-protocol NUL terminator does not confuse
    // the parser.
    let text = text.trim_end_matches(|c: char| c == '\0' || c.is_whitespace());
    // The reply format is `ClamAV <engine>/<db-version>/<db-date>`.
    let mut parts = text.splitn(3, '/');
    let _ = parts.next(); // "ClamAV <engine>" — discard
    let db_version = parts.next()?.trim();
    if db_version.is_empty() {
        return None;
    }
    Some(db_version.to_string())
}

/// Queries clamd's `VERSION` command over the existing loopback TCP transport and returns the
/// signature-database version token (e.g. `"27268"`).
///
/// The ENTIRE exchange (connect + write + read) runs under `exchange_timeout()` so a wedged daemon
/// that accepts the TCP connection but never sends a reply yields a timeout error rather than
/// blocking the caller indefinitely. The timeout error propagates to the startup retry loop, which
/// counts it toward the bounded retry budget and ultimately calls `process::exit(1)` — fail-loud,
/// never an infinite hang.
///
/// Returns an error if the connect, write, or read fails, if the timeout elapses, or if the reply
/// cannot be parsed.
pub async fn query_clamav_db_version(clamd_address: &str) -> std::io::Result<String> {
    // Wrap the whole exchange so a wedged clamd that accepts but never replies cannot hang startup.
    // `exchange_timeout()` is the same deadline used by every other clamd exchange in this module.
    let raw = timeout(exchange_timeout(), async {
        let mut stream = connect(clamd_address).await?;
        // `z`-protocol: null-terminated command.
        stream.write_all(b"zVERSION\0").await?;
        read_reply(&mut stream).await
    })
    .await
    .map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "clamd VERSION exchange timed out",
        )
    })??;
    parse_clamav_db_version(&raw).ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "clamd VERSION reply could not be parsed for the database version token",
        )
    })
}

#[cfg(test)]
mod tests {
    use super::{interpret_reply, parse_clamav_db_version, query_clamav_db_version, scan_buffer, ClamVerdict};

    #[test]
    fn instream_found_reply_is_infected_with_signature() {
        assert_eq!(
            interpret_reply(b"stream: Eicar-Test-Signature FOUND\0"),
            ClamVerdict::Infected("Eicar-Test-Signature".to_string())
        );
    }

    #[test]
    fn scan_found_reply_is_infected_with_signature() {
        // A SCAN reply is prefixed with the scratch path, not "stream:".
        assert_eq!(
            interpret_reply(b"/scan/42-7: Win.Test.EICAR_HDB-1 FOUND\0"),
            ClamVerdict::Infected("Win.Test.EICAR_HDB-1".to_string())
        );
    }

    #[test]
    fn ok_reply_is_clean_for_either_transport() {
        assert_eq!(interpret_reply(b"stream: OK\0"), ClamVerdict::Clean);
        assert_eq!(interpret_reply(b"/scan/42-7: OK\0"), ClamVerdict::Clean);
    }

    #[test]
    fn error_reply_is_unavailable_never_clean() {
        // A clamd ERROR (e.g. an unreadable path) must never be read as clean.
        assert_eq!(
            interpret_reply(b"/scan/42-7: lstat() failed: Permission denied. ERROR\0"),
            ClamVerdict::Unavailable
        );
    }

    #[test]
    fn a_found_record_is_never_masked_by_a_later_ok_record() {
        // A multi-record reply (e.g. an archive member matched, another cleared). The FOUND must win
        // regardless of record order — never-mask-a-FOUND is structural, not order-dependent.
        assert_eq!(
            interpret_reply(b"/scan/x: Some.Sig FOUND\0/scan/x: OK\0"),
            ClamVerdict::Infected("Some.Sig".to_string())
        );
        assert_eq!(
            interpret_reply(b"/scan/x: OK\0/scan/x: Some.Sig FOUND\0"),
            ClamVerdict::Infected("Some.Sig".to_string())
        );
    }

    #[test]
    fn a_found_record_wins_even_alongside_an_error_record() {
        // An error on one member must not downgrade a definitive hit on another to a retryable fault.
        assert_eq!(
            interpret_reply(b"/scan/x: read ERROR\0/scan/x: Some.Sig FOUND\0"),
            ClamVerdict::Infected("Some.Sig".to_string())
        );
    }

    #[test]
    fn an_error_among_ok_records_is_unavailable() {
        // No FOUND, but a member errored — the archive was not fully cleared, so it is a fault.
        assert_eq!(
            interpret_reply(b"/scan/x: OK\0/scan/x: read ERROR\0"),
            ClamVerdict::Unavailable
        );
    }

    #[test]
    fn empty_reply_is_unavailable() {
        // A daemon that closed the socket without replying has no OK record — never clean.
        assert_eq!(interpret_reply(b""), ClamVerdict::Unavailable);
        assert_eq!(interpret_reply(b"\0"), ClamVerdict::Unavailable);
    }

    #[test]
    fn source_only_reply_without_a_status_is_unavailable() {
        // A truncated reply that names the source but carries no OK/FOUND/ERROR status word.
        assert_eq!(interpret_reply(b"/scan/42-7: \0"), ClamVerdict::Unavailable);
    }

    #[test]
    fn truncated_ok_reply_is_unavailable() {
        // A reply cut off mid-word ("O") has no terminal OK — never read as clean.
        assert_eq!(interpret_reply(b"/scan/42-7: O"), ClamVerdict::Unavailable);
    }

    #[test]
    fn non_utf8_reply_is_unavailable() {
        // Invalid UTF-8 decodes to U+FFFD, which cannot spell OK/FOUND — so it has no clean record.
        assert_eq!(
            interpret_reply(&[0xff, 0xfe, 0x00, 0x80]),
            ClamVerdict::Unavailable
        );
    }

    // A stub clamd that accepts the connection then never replies must not hang the scan: the whole
    // exchange runs under the exchange deadline, so it returns `Unavailable` within budget rather than
    // blocking on the read forever. The budget is shrunk via env so the test is fast; an outer deadline
    // (generously larger than the shrunk budget, but far smaller than the production default) fails the
    // test if the call ever hangs past the deadline.
    #[tokio::test]
    async fn a_silent_daemon_yields_unavailable_within_budget_not_a_hang() {
        use tokio::net::TcpListener;

        // Shrink the exchange budget for the duration of this test. `exchange_timeout()` reads it per
        // call, so this is observed by `scan_buffer`. Env is process-global, so this test must be the
        // sole reader of the var — it is.
        std::env::set_var("CLAMD_EXCHANGE_TIMEOUT_SECS", "2");

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap().to_string();
        // Accept connections and then sit silently, holding the socket open (never reading or replying)
        // — the worst case for an unbounded INSTREAM write under backpressure.
        tokio::spawn(async move {
            let mut held = Vec::new();
            while let Ok((socket, _)) = listener.accept().await {
                held.push(socket);
            }
        });

        // The shrunk budget is 2s; an 8s outer deadline fails the test if the exchange hangs instead of
        // timing out. Both are far below the production default, so the test is fast and deterministic.
        let outer = std::time::Duration::from_secs(8);
        let verdict = tokio::time::timeout(outer, scan_buffer(b"some bytes to stream", &address))
            .await
            .expect("scan must not hang past the test deadline");
        std::env::remove_var("CLAMD_EXCHANGE_TIMEOUT_SECS");
        assert_eq!(verdict, ClamVerdict::Unavailable);
    }

    // --- clamd VERSION parser ---

    #[test]
    fn version_reply_parses_the_db_version_token() {
        // Standard clamd VERSION output: `ClamAV <engine>/<db-version>/<db-date>`.
        assert_eq!(
            parse_clamav_db_version(b"ClamAV 1.0.3/27268/Thu Oct 12 09:31:47 2023"),
            Some("27268".to_string())
        );
    }

    #[test]
    fn version_reply_with_trailing_nul_parses_correctly() {
        // The `z`-protocol appends a NUL terminator; strip it before parsing.
        assert_eq!(
            parse_clamav_db_version(b"ClamAV 1.0.3/27268/Thu Oct 12 09:31:47 2023\0"),
            Some("27268".to_string())
        );
    }

    #[test]
    fn version_reply_with_whitespace_is_trimmed() {
        assert_eq!(
            parse_clamav_db_version(b"ClamAV 1.0.3/27268/Thu Oct 12 09:31:47 2023\n"),
            Some("27268".to_string())
        );
    }

    #[test]
    fn malformed_version_reply_without_slashes_returns_none() {
        // A broken or unexpected reply must not produce a blank token — return `None` so the caller
        // can fail startup rather than serve with a fabricated DB version.
        assert_eq!(parse_clamav_db_version(b"something unexpected"), None);
    }

    #[test]
    fn empty_version_reply_returns_none() {
        assert_eq!(parse_clamav_db_version(b""), None);
    }

    #[test]
    fn non_utf8_version_reply_returns_none() {
        assert_eq!(parse_clamav_db_version(&[0xff, 0xfe, 0x00, 0x80]), None);
    }

    // A stub clamd that accepts the VERSION connection then never replies must not hang startup:
    // the whole exchange runs under the exchange deadline, so it returns an error within budget
    // rather than blocking on the read forever. The budget is shrunk via env so the test is fast;
    // an outer deadline (generously larger than the shrunk budget) fails the test if the call
    // ever hangs past it.
    #[tokio::test]
    async fn a_silent_daemon_yields_error_from_version_query_within_budget_not_a_hang() {
        use tokio::net::TcpListener;

        // Shrink the exchange budget for this test. `exchange_timeout()` reads it per call.
        std::env::set_var("CLAMD_EXCHANGE_TIMEOUT_SECS", "2");

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap().to_string();
        // Accept connections and hold the socket open, never sending any reply — the worst case
        // for an unbounded read.
        tokio::spawn(async move {
            let mut held = Vec::new();
            while let Ok((socket, _)) = listener.accept().await {
                held.push(socket);
            }
        });

        // The shrunk budget is 2s; a 8s outer deadline fails the test if the exchange hangs.
        let outer = std::time::Duration::from_secs(8);
        let result =
            tokio::time::timeout(outer, query_clamav_db_version(&address))
                .await
                .expect("VERSION query must not hang past the test deadline");
        std::env::remove_var("CLAMD_EXCHANGE_TIMEOUT_SECS");
        // The result must be an error (timeout) — never a successful parse of a reply that never
        // arrived.
        assert!(
            result.is_err(),
            "expected an error from a silent daemon, got: {:?}",
            result
        );
    }
}
