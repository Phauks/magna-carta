use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

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
    let mut stream = TcpStream::connect(clamd_address).await?;
    stream.set_nodelay(true)?;
    let command = format!("zSCAN {}\0", path.display());
    stream.write_all(command.as_bytes()).await?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await?;
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
    let mut stream = TcpStream::connect(clamd_address).await?;
    stream.set_nodelay(true)?;
    stream.write_all(INSTREAM_COMMAND).await?;
    for chunk in bytes.chunks(INSTREAM_CHUNK_SIZE) {
        stream
            .write_all(&(chunk.len() as u32).to_be_bytes())
            .await?;
        stream.write_all(chunk).await?;
    }
    stream.write_all(&0u32.to_be_bytes()).await?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await?;
    Ok(response)
}

/// Interprets a clamd scan reply from either transport. The reply is `<source>: OK`, `<source>:
/// <Signature> FOUND`, or `<source>: <message> ERROR`. An ERROR or any unexpected reply is
/// `Unavailable` — NEVER silently `Clean`, so an un-scanned file is never recorded as clean.
fn interpret_reply(response: &[u8]) -> ClamVerdict {
    let text = String::from_utf8_lossy(response);
    let text = text.trim_end_matches('\0').trim();
    if text.ends_with("FOUND") {
        ClamVerdict::Infected(parse_signature(text))
    } else if text.ends_with("OK") {
        ClamVerdict::Clean
    } else {
        ClamVerdict::Unavailable
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

#[cfg(test)]
mod tests {
    use super::{interpret_reply, ClamVerdict};

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
}
