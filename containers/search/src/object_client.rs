//! Reading and writing a firm's split objects — the production [`RangeReader`].
//!
//! This is the half of the range-read seam that `crates/search-core` deliberately does not have. The
//! crate defines the trait and is tested against an in-memory reader; here it is bound to real storage.
//!
//! **The engine holds no storage credentials.** It issues an ordinary HTTP request against a
//! non-routable internal host; the Workers runtime intercepts that host and hands the call to the app
//! Worker, which verifies the capability token this process was given for the current operation,
//! resolves the firm's bucket, and performs exactly one object operation. So a read here is a range GET
//! against the firm's object store, reached without this process ever holding a key to it.
//!
//! **One read in, one request out — nothing else.** No prefetch, no read-ahead, no connection-level
//! speculation, no whole-object fetch standing in for a range, and no local copy of a split. The number
//! of ranged reads a query performs is the number of object-store operations it bills, and that number
//! is what the engine is measured on (`crates/search-eval`); a well-meaning optimization in this file
//! would change the platform's cost model without changing any measurement that would notice.

use std::fmt;
use std::io::{self, Read};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use search_core::RangeReader;
use serde::Deserialize;

/// How the app Worker told this operation to reach the firm's objects. Minted per operation and short
/// lived: the engine's reach is bounded by the call it was given rather than by anything it keeps.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectAccess {
    /// Absolute base the object key is appended to, ending in a slash.
    pub base_url: String,
    /// The header name the token travels in.
    pub token_header: String,
    pub token: String,
}

impl ObjectAccess {
    fn url_for(&self, object_key: &str) -> String {
        format!("{}{}", self.base_url, object_key)
    }
}

/// A network timeout on a single ranged read. Generous relative to an object-store round trip and far
/// short of a request that has stopped making progress: a query that hangs on one split is worse than a
/// query that fails, because the caller cannot tell it from a slow corpus.
const READ_TIMEOUT: Duration = Duration::from_secs(30);

/// The header the object host answers a split's true size in. See the comment where it is read.
const SPLIT_SIZE_HEADER: &str = "x-mc-split-size";

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(READ_TIMEOUT))
        // The engine never follows a redirect. The one host it can reach is the intercepted object
        // host, and a redirect is by definition an instruction to talk to a different one.
        .max_redirects(0)
        .build()
        .into()
}

fn io_error(message: impl fmt::Display) -> io::Error {
    io::Error::other(message.to_string())
}

/// A [`RangeReader`] over one split object. Construction costs one HEAD — the total size, which is what
/// lets the footer be located from the tail — and every read after it is exactly one range GET.
pub struct HttpRangeReader {
    url: String,
    token_header: String,
    token: String,
    total_len: usize,
    agent: ureq::Agent,
    /// Ranged reads issued through this reader. Not a metric for its own sake: it is the same number
    /// the benchmark reports and the same number the deployment bills, so having it on the response
    /// makes the two comparable instead of merely believed to be equal.
    reads: Arc<AtomicUsize>,
}

impl fmt::Debug for HttpRangeReader {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // The URL carries a firm's object key and the token is a credential; neither belongs in a log
        // line, so the debug form is deliberately contentless.
        f.debug_struct("HttpRangeReader")
            .field("total_len", &self.total_len)
            .field("reads", &self.reads.load(Ordering::Relaxed))
            .finish()
    }
}

impl HttpRangeReader {
    pub fn open(
        access: &ObjectAccess,
        object_key: &str,
        reads: Arc<AtomicUsize>,
    ) -> io::Result<Self> {
        let agent = agent();
        let url = access.url_for(object_key);
        let response = agent
            .head(&url)
            .header(&access.token_header, &access.token)
            .call()
            .map_err(|error| io_error(format!("split head failed: {error}")))?;
        if response.status() != 200 {
            return Err(io_error(format!(
                "split head refused with status {}",
                response.status()
            )));
        }
        // The host's own size header first, content-length second. A bodyless response is one a
        // runtime may rewrite the content-length of, and a reader that learns the wrong length looks
        // for the footer in the wrong place — so the authoritative answer travels in a header nothing
        // in the path has a reason to touch. Kept in sync with SPLIT_OBJECT_SIZE_HEADER in
        // apps/api-worker/src/search/split-object-host.ts.
        let header = |name: &str| {
            response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<usize>().ok())
        };
        let total_len = header(SPLIT_SIZE_HEADER)
            .or_else(|| header("content-length"))
            .ok_or_else(|| io_error("split head returned no usable size"))?;
        Ok(Self {
            url,
            token_header: access.token_header.clone(),
            token: access.token.clone(),
            total_len,
            agent,
            reads,
        })
    }

    pub fn reads_issued(&self) -> usize {
        self.reads.load(Ordering::Relaxed)
    }
}

impl RangeReader for HttpRangeReader {
    fn read_range(&self, offset: usize, length: usize) -> io::Result<Vec<u8>> {
        if length == 0 {
            return Ok(Vec::new());
        }
        let last = offset
            .checked_add(length - 1)
            .ok_or_else(|| io_error("range overflows"))?;
        self.reads.fetch_add(1, Ordering::Relaxed);
        let response = self
            .agent
            .get(&self.url)
            .header(&self.token_header, &self.token)
            .header("range", format!("bytes={offset}-{last}"))
            .call()
            .map_err(|error| io_error(format!("split range read failed: {error}")))?;
        if response.status() != 206 {
            return Err(io_error(format!(
                "split range read refused with status {}",
                response.status()
            )));
        }
        // Exactly `length` bytes, or an error. A short read is a corrupt or truncated split, never a
        // partial success — the trait says so, and a searcher handed short bytes reports nonsense
        // rather than failing.
        let mut buffer = vec![0_u8; length];
        response
            .into_body()
            .into_reader()
            .read_exact(&mut buffer)
            .map_err(|error| io_error(format!("split range read was short: {error}")))?;
        Ok(buffer)
    }

    fn total_len(&self) -> usize {
        self.total_len
    }
}

/// Publish a built split. One PUT of the bytes the engine just produced; the app Worker stamps the
/// object's dimensions and decides where in the firm's bucket it lands, because the engine has no
/// business naming either.
pub fn put_object(access: &ObjectAccess, object_key: &str, bytes: Vec<u8>) -> io::Result<()> {
    let response = agent()
        .put(&access.url_for(object_key))
        .header(&access.token_header, &access.token)
        .header("content-type", "application/octet-stream")
        .send(&bytes[..])
        .map_err(|error| io_error(format!("split publish failed: {error}")))?;
    if response.status() != 200 {
        return Err(io_error(format!(
            "split publish refused with status {}",
            response.status()
        )));
    }
    Ok(())
}
