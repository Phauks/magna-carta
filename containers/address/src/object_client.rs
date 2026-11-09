//! The address index's object storage, reached through the intercepted host.
//!
//! **The engine holds no credential.** Every call is plain HTTP to `addresses.magna-carta.internal`, a
//! non-routable name the address worker intercepts and serves from its R2 binding. The path shapes are
//! the worker's contract (`apps/address-worker`), and a change here is a change there.
//!
//! Two halves, split on purpose:
//!
//! - [`ObjectStore`] reads: a HEAD for a size, a closed-range GET, and a whole GET of a small object
//!   (the pointer and the manifest). It is all the query path is given, so the query path cannot write.
//! - [`ObjectWriter`] writes: small PUTs, the multipart upload a split streams into, and DELETE. Only the
//!   build job holds one.
//!
//! Reads are cached. A split is immutable and the data is public reference data identical for every
//! firm, so the bytes a query read are as good for the next query as for this one: [`RangeCache`] keeps
//! them, bounded and least recently used out first, and lets only one request for the same range be in
//! flight at once.

use std::collections::{BTreeMap, HashMap};
use std::fmt;
use std::io::{self, Read, Write};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::Duration;

use search_core::RangeReader;
use serde::{Deserialize, Serialize};

/// The production object host.
pub const OBJECT_HOST: &str = "http://addresses.magna-carta.internal";

/// The size the worker answers a HEAD with, in preference to `content-length`: a bodyless response is
/// one a runtime may rewrite the length of, and a reader that learns the wrong size looks for the
/// footer in the wrong place.
const OBJECT_SIZE_HEADER: &str = "x-mc-object-size";
/// Asks for a whole small object (the worker refuses it above 1 MiB).
const WHOLE_HEADER: &str = "x-mc-whole";
/// The worker's ceiling on a whole GET and a small PUT.
pub const SMALL_OBJECT_LIMIT: usize = 1024 * 1024;
/// The largest JSON answer read from the host (an upload id, an etag): anything bigger is not one.
const CONTROL_ANSWER_LIMIT: u64 = 64 * 1024;

/// A ranged read: generous against an object-store round trip, far short of a request that stopped.
const READ_TIMEOUT: Duration = Duration::from_secs(30);
/// One 64 MiB part going up.
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(600);

fn io_error(message: impl fmt::Display) -> io::Error {
    io::Error::other(message.to_string())
}

fn agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(timeout))
        // The engine never follows a redirect: the one host it may reach is the intercepted one, and a
        // redirect is an instruction to talk to another.
        .max_redirects(0)
        // Statuses are read and mapped here, so a 404 is an answer rather than a transport error.
        .http_status_as_error(false)
        .build()
        .into()
}

/// Percent-encode a query-string value: everything but the unreserved characters.
fn encode_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// Read access to the object host.
#[derive(Clone)]
pub struct ObjectStore {
    base_url: String,
    agent: ureq::Agent,
}

impl fmt::Debug for ObjectStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ObjectStore")
            .finish_non_exhaustive()
    }
}

impl ObjectStore {
    /// `base_url` is the host's origin, without a trailing slash: [`OBJECT_HOST`] in production, a local
    /// fake in tests.
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_owned(),
            agent: agent(READ_TIMEOUT),
        }
    }

    fn object_url(&self, key: &str) -> String {
        format!("{}/objects/{key}", self.base_url)
    }

    /// The object's size, or `None` when it does not exist.
    pub fn size(&self, key: &str) -> io::Result<Option<usize>> {
        let response = self
            .agent
            .head(&self.object_url(key))
            .call()
            .map_err(|error| io_error(format!("object head failed: {error}")))?;
        match response.status().as_u16() {
            200 => {}
            404 => return Ok(None),
            status => {
                return Err(io_error(format!(
                    "object head refused with status {status}"
                )))
            }
        }
        let header = |name: &str| {
            response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.trim().parse::<usize>().ok())
        };
        header(OBJECT_SIZE_HEADER)
            .or_else(|| header("content-length"))
            .map(Some)
            .ok_or_else(|| io_error("object head returned no usable size"))
    }

    /// Exactly `length` bytes from `offset`, or an error. A short answer is a truncated or replaced
    /// object, never a partial success.
    pub fn read_range(&self, key: &str, offset: usize, length: usize) -> io::Result<Vec<u8>> {
        if length == 0 {
            return Ok(Vec::new());
        }
        let last = offset
            .checked_add(length - 1)
            .ok_or_else(|| io_error("range overflows"))?;
        let response = self
            .agent
            .get(&self.object_url(key))
            .header("range", format!("bytes={offset}-{last}"))
            .call()
            .map_err(|error| io_error(format!("object range read failed: {error}")))?;
        let status = response.status().as_u16();
        if status != 206 {
            return Err(io_error(format!(
                "object range read refused with status {status}"
            )));
        }
        let mut buffer = vec![0_u8; length];
        response
            .into_body()
            .into_reader()
            .read_exact(&mut buffer)
            .map_err(|error| io_error(format!("object range read was short: {error}")))?;
        Ok(buffer)
    }

    /// A whole small object (at most 1 MiB), or `None` when it does not exist.
    pub fn get_small(&self, key: &str) -> io::Result<Option<Vec<u8>>> {
        let response = self
            .agent
            .get(&self.object_url(key))
            .header(WHOLE_HEADER, "small")
            .call()
            .map_err(|error| io_error(format!("small object read failed: {error}")))?;
        match response.status().as_u16() {
            200 => {}
            404 => return Ok(None),
            status => {
                return Err(io_error(format!(
                    "small object read refused with status {status}"
                )))
            }
        }
        let mut bytes = Vec::new();
        response
            .into_body()
            .into_reader()
            .take(SMALL_OBJECT_LIMIT as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| io_error(format!("small object read was cut off: {error}")))?;
        if bytes.len() > SMALL_OBJECT_LIMIT {
            return Err(io_error("small object exceeds the small-object limit"));
        }
        Ok(Some(bytes))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartedUpload {
    upload_id: String,
}

#[derive(Deserialize)]
struct UploadedPart {
    etag: String,
}

#[derive(Serialize)]
struct CompletedPart<'a> {
    part: u32,
    etag: &'a str,
}

#[derive(Serialize)]
struct CompleteUpload<'a> {
    parts: Vec<CompletedPart<'a>>,
}

/// Write access to the object host. Held only by the build job.
#[derive(Clone)]
pub struct ObjectWriter {
    base_url: String,
    agent: ureq::Agent,
}

impl fmt::Debug for ObjectWriter {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ObjectWriter")
            .finish_non_exhaustive()
    }
}

fn expect_success(status: u16, what: &str) -> io::Result<()> {
    if (200..300).contains(&status) {
        Ok(())
    } else {
        Err(io_error(format!("{what} refused with status {status}")))
    }
}

fn read_control_answer<T: serde::de::DeserializeOwned>(
    response: ureq::http::Response<ureq::Body>,
    what: &str,
) -> io::Result<T> {
    let mut bytes = Vec::new();
    response
        .into_body()
        .into_reader()
        .take(CONTROL_ANSWER_LIMIT)
        .read_to_end(&mut bytes)
        .map_err(|error| io_error(format!("{what} answer unreadable: {error}")))?;
    serde_json::from_slice(&bytes).map_err(|_| io_error(format!("{what} answer malformed")))
}

impl ObjectWriter {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_owned(),
            agent: agent(TRANSFER_TIMEOUT),
        }
    }

    fn object_url(&self, key: &str) -> String {
        format!("{}/objects/{key}", self.base_url)
    }

    fn upload_url(&self, key: &str) -> String {
        format!("{}/uploads/{key}", self.base_url)
    }

    /// Put a small object (the pointer, the manifest).
    pub fn put_small(&self, key: &str, bytes: &[u8]) -> io::Result<()> {
        if bytes.len() > SMALL_OBJECT_LIMIT {
            return Err(io_error("small object exceeds the small-object limit"));
        }
        let response = self
            .agent
            .put(&self.object_url(key))
            .header("content-type", "application/json")
            .send(bytes)
            .map_err(|error| io_error(format!("small object write failed: {error}")))?;
        expect_success(response.status().as_u16(), "small object write")
    }

    /// Remove an object. An object already gone is not an error.
    pub fn delete(&self, key: &str) -> io::Result<()> {
        let response = self
            .agent
            .delete(&self.object_url(key))
            .call()
            .map_err(|error| io_error(format!("object delete failed: {error}")))?;
        match response.status().as_u16() {
            404 => Ok(()),
            status => expect_success(status, "object delete"),
        }
    }

    fn start_upload(&self, key: &str) -> io::Result<String> {
        let response = self
            .agent
            .post(&self.upload_url(key))
            .send_empty()
            .map_err(|error| io_error(format!("upload start failed: {error}")))?;
        expect_success(response.status().as_u16(), "upload start")?;
        let started: StartedUpload = read_control_answer(response, "upload start")?;
        Ok(started.upload_id)
    }

    fn upload_part(
        &self,
        key: &str,
        upload_id: &str,
        part: u32,
        bytes: &[u8],
    ) -> io::Result<String> {
        let url = format!(
            "{}?uploadId={}&part={part}",
            self.upload_url(key),
            encode_component(upload_id)
        );
        // `send` with a byte slice sets content-length, which the worker requires of a part.
        let response = self
            .agent
            .put(&url)
            .header("content-type", "application/octet-stream")
            .send(bytes)
            .map_err(|error| io_error(format!("upload part failed: {error}")))?;
        expect_success(response.status().as_u16(), "upload part")?;
        let uploaded: UploadedPart = read_control_answer(response, "upload part")?;
        Ok(uploaded.etag)
    }

    fn complete_upload(
        &self,
        key: &str,
        upload_id: &str,
        parts: &[(u32, String)],
    ) -> io::Result<()> {
        let url = format!(
            "{}/complete?uploadId={}",
            self.upload_url(key),
            encode_component(upload_id)
        );
        let body = serde_json::to_vec(&CompleteUpload {
            parts: parts
                .iter()
                .map(|(part, etag)| CompletedPart { part: *part, etag })
                .collect(),
        })
        .map_err(|_| io_error("upload completion could not be encoded"))?;
        let response = self
            .agent
            .post(&url)
            .header("content-type", "application/json")
            .send(&body[..])
            .map_err(|error| io_error(format!("upload completion failed: {error}")))?;
        expect_success(response.status().as_u16(), "upload completion")
    }

    /// Start a multipart upload that a split can be streamed into.
    pub fn multipart(&self, key: &str, part_size: usize) -> io::Result<MultipartUpload> {
        if part_size == 0 {
            return Err(io_error("a part size must be positive"));
        }
        let upload_id = self.start_upload(key)?;
        Ok(MultipartUpload {
            writer: self.clone(),
            key: key.to_owned(),
            upload_id,
            part_size,
            buffer: Vec::with_capacity(part_size),
            parts: Vec::new(),
            total: 0,
        })
    }
}

/// A multipart upload driven as a `Write`. Bytes are buffered into parts of exactly `part_size` (the
/// object store requires every part but the last to be the same size), each sent as soon as it is full,
/// so at most one part is ever held in memory. [`MultipartUpload::finish`] sends the last part and
/// completes the object; dropping the upload without finishing leaves an incomplete upload the store
/// expires on its own, and no object.
pub struct MultipartUpload {
    writer: ObjectWriter,
    key: String,
    upload_id: String,
    part_size: usize,
    buffer: Vec<u8>,
    parts: Vec<(u32, String)>,
    total: u64,
}

impl fmt::Debug for MultipartUpload {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MultipartUpload")
            .field("parts", &self.parts.len())
            .field("total", &self.total)
            .finish_non_exhaustive()
    }
}

impl MultipartUpload {
    fn send_part(&mut self) -> io::Result<()> {
        let number =
            u32::try_from(self.parts.len() + 1).map_err(|_| io_error("too many upload parts"))?;
        let etag = self
            .writer
            .upload_part(&self.key, &self.upload_id, number, &self.buffer)?;
        self.parts.push((number, etag));
        self.buffer.clear();
        Ok(())
    }

    /// Send what is buffered as the last part and complete the object. Returns the object's size.
    pub fn finish(mut self) -> io::Result<u64> {
        if !self.buffer.is_empty() || self.parts.is_empty() {
            self.send_part()?;
        }
        self.writer
            .complete_upload(&self.key, &self.upload_id, &self.parts)?;
        Ok(self.total)
    }
}

impl Write for MultipartUpload {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let room = self.part_size - self.buffer.len();
        let taken = bytes.len().min(room);
        self.buffer
            .extend_from_slice(bytes.get(..taken).unwrap_or_default());
        self.total += taken as u64;
        if self.buffer.len() == self.part_size {
            self.send_part()?;
        }
        Ok(taken)
    }

    /// Deliberately sends nothing: a part may only go up when it is full, or as the last part from
    /// `finish`. Flushing a partial part would break the equal-size rule.
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// One split object read by range, uncached. Opening costs one HEAD; each read after it is one GET.
pub struct HttpRangeReader {
    store: ObjectStore,
    key: String,
    total_len: usize,
    /// Requests that actually left the process, for the read-count tests and the cache's evidence.
    reads: Arc<AtomicUsize>,
}

impl fmt::Debug for HttpRangeReader {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        // The key is left out so a debug line never names an object.
        formatter
            .debug_struct("HttpRangeReader")
            .field("total_len", &self.total_len)
            .finish_non_exhaustive()
    }
}

impl HttpRangeReader {
    pub fn open(store: &ObjectStore, key: &str, reads: Arc<AtomicUsize>) -> io::Result<Self> {
        let total_len = store
            .size(key)?
            .ok_or_else(|| io_error("split object is missing"))?;
        Ok(Self {
            store: store.clone(),
            key: key.to_owned(),
            total_len,
            reads,
        })
    }

    pub fn key(&self) -> &str {
        &self.key
    }
}

impl RangeReader for HttpRangeReader {
    fn read_range(&self, offset: usize, length: usize) -> io::Result<Vec<u8>> {
        self.reads.fetch_add(1, Ordering::Relaxed);
        self.store.read_range(&self.key, offset, length)
    }

    fn total_len(&self) -> usize {
        self.total_len
    }
}

/// The production query cache budget: 384 MB of a 1 GiB instance, leaving the rest for the open
/// partitions' dictionaries and the requests in flight.
pub const CACHE_BUDGET_BYTES: usize = 384 * 1024 * 1024;

type CacheKey = (Arc<str>, usize, usize);

struct CacheEntry {
    bytes: Arc<Vec<u8>>,
    tick: u64,
}

/// A read in progress that other readers of the same range wait on.
#[derive(Default)]
struct Flight {
    outcome: Mutex<Option<Result<Arc<Vec<u8>>, String>>>,
    landed: Condvar,
}

#[derive(Default)]
struct CacheState {
    entries: HashMap<CacheKey, CacheEntry>,
    recency: BTreeMap<u64, CacheKey>,
    in_flight: HashMap<CacheKey, Arc<Flight>>,
    tick: u64,
    bytes: usize,
}

impl CacheState {
    fn next_tick(&mut self) -> u64 {
        self.tick += 1;
        self.tick
    }

    fn insert(&mut self, key: CacheKey, bytes: Arc<Vec<u8>>, budget: usize) {
        if bytes.len() > budget {
            return;
        }
        let tick = self.next_tick();
        if let Some(previous) = self.entries.insert(
            key.clone(),
            CacheEntry {
                bytes: bytes.clone(),
                tick,
            },
        ) {
            self.recency.remove(&previous.tick);
            self.bytes -= previous.bytes.len();
        }
        self.recency.insert(tick, key);
        self.bytes += bytes.len();
        while self.bytes > budget {
            let Some((_, oldest)) = self.recency.pop_first() else {
                break;
            };
            if let Some(evicted) = self.entries.remove(&oldest) {
                self.bytes -= evicted.bytes.len();
            }
        }
    }
}

/// Counts of what the cache did, for tests and diagnostics.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CacheStatistics {
    pub hits: usize,
    pub misses: usize,
    pub bytes: usize,
    pub entries: usize,
}

/// Byte ranges already read, shared by every partition reader, bounded, least recently used out first.
/// Keyed by object key and exact range: Tantivy re-reads the same blocks with the same ranges, which is
/// what makes an exact key enough.
pub struct RangeCache {
    budget: usize,
    state: Mutex<CacheState>,
    hits: AtomicUsize,
    misses: AtomicUsize,
}

impl fmt::Debug for RangeCache {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RangeCache")
            .field("statistics", &self.statistics())
            .finish()
    }
}

impl RangeCache {
    pub fn new(budget: usize) -> Arc<Self> {
        Arc::new(Self {
            budget,
            state: Mutex::new(CacheState::default()),
            hits: AtomicUsize::new(0),
            misses: AtomicUsize::new(0),
        })
    }

    pub fn statistics(&self) -> CacheStatistics {
        let state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        CacheStatistics {
            hits: self.hits.load(Ordering::Relaxed),
            misses: self.misses.load(Ordering::Relaxed),
            bytes: state.bytes,
            entries: state.entries.len(),
        }
    }

    /// The cached bytes for `key`, or the result of `fetch` — which runs at most once at a time per key,
    /// however many readers ask for the range together.
    fn get_or_fetch(
        &self,
        key: CacheKey,
        fetch: impl FnOnce() -> io::Result<Vec<u8>>,
    ) -> io::Result<Vec<u8>> {
        let flight = {
            let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
            let tick = state.next_tick();
            if let Some(entry) = state.entries.get_mut(&key) {
                let previous = entry.tick;
                entry.tick = tick;
                let bytes = entry.bytes.clone();
                state.recency.remove(&previous);
                state.recency.insert(tick, key);
                self.hits.fetch_add(1, Ordering::Relaxed);
                return Ok(bytes.as_ref().clone());
            }
            if let Some(flight) = state.in_flight.get(&key) {
                Some(flight.clone())
            } else {
                state
                    .in_flight
                    .insert(key.clone(), Arc::new(Flight::default()));
                None
            }
        };

        if let Some(flight) = flight {
            // Someone else is reading this range: wait for their answer rather than paying twice.
            let mut outcome = flight
                .outcome
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            while outcome.is_none() {
                outcome = flight
                    .landed
                    .wait(outcome)
                    .unwrap_or_else(PoisonError::into_inner);
            }
            self.hits.fetch_add(1, Ordering::Relaxed);
            return match outcome.as_ref() {
                Some(Ok(bytes)) => Ok(bytes.as_ref().clone()),
                Some(Err(message)) => Err(io_error(message)),
                None => Err(io_error("a shared range read ended without an answer")),
            };
        }

        self.misses.fetch_add(1, Ordering::Relaxed);
        let fetched = fetch().map(Arc::new);
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        let flight = state.in_flight.remove(&key);
        if let Ok(bytes) = &fetched {
            state.insert(key, bytes.clone(), self.budget);
        }
        drop(state);
        if let Some(flight) = flight {
            let mut outcome = flight
                .outcome
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            *outcome = Some(match &fetched {
                Ok(bytes) => Ok(bytes.clone()),
                Err(error) => Err(error.to_string()),
            });
            flight.landed.notify_all();
        }
        fetched.map(|bytes| bytes.as_ref().clone())
    }
}

/// A range reader whose reads go through the shared [`RangeCache`].
pub struct CachedRangeReader {
    inner: HttpRangeReader,
    key: Arc<str>,
    cache: Arc<RangeCache>,
}

impl fmt::Debug for CachedRangeReader {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CachedRangeReader")
            .field("inner", &self.inner)
            .finish_non_exhaustive()
    }
}

impl CachedRangeReader {
    pub fn new(inner: HttpRangeReader, cache: Arc<RangeCache>) -> Self {
        let key: Arc<str> = Arc::from(inner.key());
        Self { inner, key, cache }
    }
}

impl RangeReader for CachedRangeReader {
    fn read_range(&self, offset: usize, length: usize) -> io::Result<Vec<u8>> {
        self.cache
            .get_or_fetch((self.key.clone(), offset, length), || {
                self.inner.read_range(offset, length)
            })
    }

    fn total_len(&self) -> usize {
        self.inner.total_len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(offset: usize) -> CacheKey {
        (Arc::from("k"), offset, 10)
    }

    #[test]
    fn the_cache_evicts_the_least_recently_used_first() {
        let cache = RangeCache::new(25);
        for offset in [0, 10] {
            cache.get_or_fetch(key(offset), || Ok(vec![0; 10])).unwrap();
        }
        // Touch the first, so the second is the oldest when the third arrives.
        cache
            .get_or_fetch(key(0), || Err(io_error("must be cached")))
            .unwrap();
        cache.get_or_fetch(key(20), || Ok(vec![0; 10])).unwrap();
        let statistics = cache.statistics();
        assert_eq!(statistics.entries, 2);
        assert_eq!(statistics.bytes, 20);
        assert!(cache
            .get_or_fetch(key(0), || Err(io_error("evicted")))
            .is_ok());
        assert!(cache
            .get_or_fetch(key(10), || Err(io_error("evicted")))
            .is_err());
    }

    #[test]
    fn a_range_larger_than_the_budget_is_served_but_not_kept() {
        let cache = RangeCache::new(5);
        assert_eq!(
            cache
                .get_or_fetch(key(0), || Ok(vec![1; 10]))
                .unwrap()
                .len(),
            10
        );
        assert_eq!(cache.statistics().entries, 0);
    }

    #[test]
    fn a_failed_read_is_not_cached() {
        let cache = RangeCache::new(100);
        assert!(cache
            .get_or_fetch(key(0), || Err(io_error("down")))
            .is_err());
        assert_eq!(
            cache.get_or_fetch(key(0), || Ok(vec![2; 10])).unwrap(),
            vec![2; 10]
        );
    }

    #[test]
    fn concurrent_readers_of_one_range_share_one_fetch() {
        let cache = RangeCache::new(1000);
        let fetches = AtomicUsize::new(0);
        std::thread::scope(|scope| {
            for _ in 0..8 {
                scope.spawn(|| {
                    cache
                        .get_or_fetch(key(0), || {
                            fetches.fetch_add(1, Ordering::SeqCst);
                            std::thread::sleep(Duration::from_millis(50));
                            Ok(vec![3; 10])
                        })
                        .unwrap()
                });
            }
        });
        assert_eq!(fetches.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn upload_identifiers_are_encoded_for_the_query_string() {
        assert_eq!(encode_component("a+b/c=d e"), "a%2Bb%2Fc%3Dd%20e");
        assert_eq!(encode_component("plain-id_1.2~"), "plain-id_1.2~");
    }
}
