// R2 GET/PUT over the outbound-Workers base URL. The container holds no R2 credentials and performs no
// general egress: it issues plain HTTP GET/PUT against `{base}/{key}`, which in production the owner
// Worker intercepts (outbound Workers) and services via its `env.R2` binding. Bodies stream both
// directions so a large archive never fully buffers in memory.
use futures_util::StreamExt;
use std::io::Write;

#[derive(Debug)]
pub enum R2Error {
    Http(reqwest::Error),
    Status(reqwest::StatusCode),
    Io(std::io::Error),
}
impl std::fmt::Display for R2Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            R2Error::Http(e) => write!(f, "r2 http error: {e}"),
            R2Error::Status(s) => write!(f, "r2 unexpected status: {s}"),
            R2Error::Io(e) => write!(f, "r2 io error: {e}"),
        }
    }
}
impl std::error::Error for R2Error {}

fn url(base: &str, key: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        key.trim_start_matches('/')
    )
}

/// Streams `GET {base}/{key}` into `dst` chunk-by-chunk (the body never fully buffers in memory).
/// Returns the number of bytes written.
pub async fn get_to_writer<W: Write>(
    http: &reqwest::Client,
    base: &str,
    key: &str,
    dst: &mut W,
) -> Result<u64, R2Error> {
    let resp = http
        .get(url(base, key))
        .send()
        .await
        .map_err(R2Error::Http)?;
    if !resp.status().is_success() {
        return Err(R2Error::Status(resp.status()));
    }
    let mut total = 0u64;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(R2Error::Http)?;
        dst.write_all(&chunk).map_err(R2Error::Io)?;
        total += chunk.len() as u64;
    }
    Ok(total)
}

/// Streams a sized `PUT {base}/{key}` from a file. The explicit Content-Length (`len`) is required —
/// R2 rejects an unknown-length body. The file is consumed as a streaming body, never read into memory.
pub async fn put_file(
    http: &reqwest::Client,
    base: &str,
    key: &str,
    file: tokio::fs::File,
    len: u64,
) -> Result<(), R2Error> {
    let stream = tokio_util::io::ReaderStream::new(file);
    let body = reqwest::Body::wrap_stream(stream);
    let resp = http
        .put(url(base, key))
        .header(reqwest::header::CONTENT_LENGTH, len)
        .body(body)
        .send()
        .await
        .map_err(R2Error::Http)?;
    if !resp.status().is_success() {
        return Err(R2Error::Status(resp.status()));
    }
    Ok(())
}
