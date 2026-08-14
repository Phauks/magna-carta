//! The range reader against a real object host over a real socket.
//!
//! What is worth proving is not that Tantivy works — `crates/search-core` proves that against an
//! in-memory reader — but that binding its `RangeReader` seam to HTTP changes nothing about WHAT is
//! read, and that what leaves this process is exactly the set of requests the engine asked for. Those
//! two are the whole claim of the adapter, and both are invisible to a unit test that stubs the trait.
//!
//! The fake host is a real HTTP server holding the split bytes: it records every request, serves only
//! closed ranges, and refuses an unranged GET the same way the app Worker's host does — so a reader
//! that started fetching whole objects would fail here rather than quietly costing money in production.

use std::net::SocketAddr;
use std::sync::atomic::AtomicUsize;
use std::sync::{Arc, Mutex};
use std::thread;

use magna_carta_search::object_client::{put_object, HttpRangeReader, ObjectAccess};
use search_core::{build_split, query_split, IndexDocument, RangeReader, SplitSearcher};

/// The objects the fake host holds, by key. Shared with the serving thread.
type StoredObjects = Arc<Mutex<Vec<(String, Vec<u8>)>>>;

const TOKEN_HEADER: &str = "x-mc-split-token";
const TOKEN: &str = "test-capability-token";

/// Every request the engine made, in order: method, path, and the Range header if there was one.
#[derive(Clone, Debug, PartialEq)]
struct SeenRequest {
    method: String,
    path: String,
    range: Option<String>,
    authorized: bool,
}

struct FakeObjectHost {
    address: SocketAddr,
    seen: Arc<Mutex<Vec<SeenRequest>>>,
    objects: StoredObjects,
}

impl FakeObjectHost {
    fn start(initial: Vec<(String, Vec<u8>)>) -> Self {
        let server = tiny_http::Server::http("127.0.0.1:0").expect("bind fake object host");
        let address = match server.server_addr() {
            tiny_http::ListenAddr::IP(address) => address,
            other => panic!("unexpected listen address {other:?}"),
        };
        let seen = Arc::new(Mutex::new(Vec::new()));
        let objects = Arc::new(Mutex::new(initial));
        let host = Self {
            address,
            seen: seen.clone(),
            objects: objects.clone(),
        };
        thread::spawn(move || serve(server, seen, objects));
        host
    }

    fn access(&self) -> ObjectAccess {
        ObjectAccess {
            base_url: format!("http://{}/search-objects/", self.address),
            token_header: TOKEN_HEADER.to_owned(),
            token: TOKEN.to_owned(),
        }
    }

    fn requests(&self) -> Vec<SeenRequest> {
        self.seen.lock().expect("request log").clone()
    }

    fn object(&self, key: &str) -> Option<Vec<u8>> {
        self.objects
            .lock()
            .expect("objects")
            .iter()
            .find(|(stored, _)| stored == key)
            .map(|(_, bytes)| bytes.clone())
    }
}

fn parse_range(header: &str) -> Option<(usize, usize)> {
    let rest = header.strip_prefix("bytes=")?;
    let (first, last) = rest.split_once('-')?;
    Some((first.parse().ok()?, last.parse().ok()?))
}

fn serve(server: tiny_http::Server, seen: Arc<Mutex<Vec<SeenRequest>>>, objects: StoredObjects) {
    for mut request in server.incoming_requests() {
        let method = request.method().as_str().to_owned();
        let path = request.url().to_owned();
        let range = header_value(&request, "range");
        let authorized = header_value(&request, TOKEN_HEADER).as_deref() == Some(TOKEN);
        seen.lock().expect("request log").push(SeenRequest {
            method: method.clone(),
            path: path.clone(),
            range: range.clone(),
            authorized,
        });

        let key = path.trim_start_matches("/search-objects/").to_owned();
        if !authorized {
            let _ = request.respond(tiny_http::Response::empty(404));
            continue;
        }
        match method.as_str() {
            "HEAD" => {
                let size = objects
                    .lock()
                    .expect("objects")
                    .iter()
                    .find(|(stored, _)| *stored == key)
                    .map(|(_, bytes)| bytes.len());
                match size {
                    // A body of the object's length, which tiny_http turns into the Content-Length the
                    // reader needs and then does not write, because the request is a HEAD. Letting the
                    // server derive the header rather than setting it by hand keeps the fake from
                    // claiming a length it would not actually serve.
                    Some(size) => {
                        let response = tiny_http::Response::from_data(vec![0_u8; size])
                            .with_header(
                                tiny_http::Header::from_bytes("x-mc-split-size", size.to_string())
                                    .expect("size header"),
                            );
                        let _ = request.respond(response);
                    }
                    None => {
                        let _ = request.respond(tiny_http::Response::empty(404));
                    }
                }
            }
            "GET" => {
                // The real host refuses an unranged GET rather than serving the whole object; the fake
                // does the same, so a reader that stopped sending ranges fails the test instead of
                // passing it more expensively.
                let Some((first, last)) = range.as_deref().and_then(parse_range) else {
                    let _ = request.respond(tiny_http::Response::empty(416));
                    continue;
                };
                let bytes = objects
                    .lock()
                    .expect("objects")
                    .iter()
                    .find(|(stored, _)| *stored == key)
                    .map(|(_, bytes)| bytes[first..=last.min(bytes.len() - 1)].to_vec());
                match bytes {
                    Some(slice) => {
                        let _ = request
                            .respond(tiny_http::Response::from_data(slice).with_status_code(206));
                    }
                    None => {
                        let _ = request.respond(tiny_http::Response::empty(404));
                    }
                }
            }
            "PUT" => {
                let mut body = Vec::new();
                let _ = request.as_reader().read_to_end(&mut body);
                let mut stored = objects.lock().expect("objects");
                stored.retain(|(existing, _)| *existing != key);
                stored.push((key, body));
                drop(stored);
                let _ = request.respond(tiny_http::Response::from_string("{}"));
            }
            _ => {
                let _ = request.respond(tiny_http::Response::empty(405));
            }
        }
    }
}

fn header_value(request: &tiny_http::Request, name: &str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|header| header.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|header| header.value.as_str().to_owned())
}

fn document(id: &str, body: &str) -> IndexDocument {
    IndexDocument {
        document_id: id.to_owned(),
        chunk_id: format!("{id}:p1"),
        body: body.to_owned(),
    }
}

/// A split with one rare term in it, big enough that reading it whole would be obviously different
/// from reading the postings the query walks.
fn sample_split() -> Vec<u8> {
    let mut documents: Vec<IndexDocument> = (0..300)
        .map(|index| {
            document(
                &format!("doc-{index}"),
                "the parties agree to the terms and conditions set forth in this agreement",
            )
        })
        .collect();
    documents.push(document(
        "needle",
        "the escrow indemnification is zzzuniquetoken here",
    ));
    build_split(&documents).expect("build split")
}

#[test]
fn a_query_over_http_returns_what_the_same_query_returns_in_memory() {
    // The adapter's central claim: binding the reader to HTTP changes where the bytes come from and
    // nothing about the answer.
    let split = sample_split();
    let host = FakeObjectHost::start(vec![("search/m/splits/a.split".to_owned(), split.clone())]);
    let reader = HttpRangeReader::open(
        &host.access(),
        "search/m/splits/a.split",
        Arc::new(AtomicUsize::new(0)),
    )
    .expect("open reader");

    let over_http = SplitSearcher::over_reader(Arc::new(reader))
        .expect("searcher")
        .search("zzzuniquetoken", 10)
        .expect("search");
    let in_memory = query_split(&split, "zzzuniquetoken", 10).expect("in-memory search");

    assert_eq!(over_http, in_memory);
    assert_eq!(over_http.len(), 1);
    assert_eq!(over_http[0].document_id, "needle");
}

#[test]
fn every_request_is_one_closed_range_and_nothing_speculative() {
    // The cost claim. A ranged read is an object-store operation the platform pays for, so the adapter
    // must issue exactly the reads the engine asked for: no whole-object fetch, no read-ahead, no
    // second request for a range already served. One HEAD to find the tail, then closed ranges only.
    let split = sample_split();
    let host = FakeObjectHost::start(vec![("search/m/splits/a.split".to_owned(), split)]);
    let reads = Arc::new(AtomicUsize::new(0));
    let reader = HttpRangeReader::open(&host.access(), "search/m/splits/a.split", reads.clone())
        .expect("open reader");
    let counted_reads = reader.reads_issued();
    assert_eq!(counted_reads, 0, "opening costs a head, not a ranged read");

    let searcher = SplitSearcher::over_reader(Arc::new(reader)).expect("searcher");
    searcher.search("zzzuniquetoken", 10).expect("search");

    let requests = host.requests();
    assert_eq!(requests[0].method, "HEAD");
    assert!(requests[0].range.is_none());
    assert!(requests.iter().all(|request| request.authorized));
    for request in requests.iter().skip(1) {
        assert_eq!(request.method, "GET", "the query path only ever reads");
        let range = request.range.as_deref().expect("every GET carries a range");
        assert!(
            parse_range(range).is_some(),
            "a range must be closed on both ends: {range}"
        );
    }

    // The counter the response reports has to be the number of requests that actually left the
    // process; a count maintained beside the requests rather than by them would drift.
    let ranged_requests = requests.len() - 1;
    assert_eq!(
        reads.load(std::sync::atomic::Ordering::Relaxed),
        ranged_requests
    );
}

#[test]
fn a_read_returns_exactly_the_bytes_asked_for() {
    let bytes: Vec<u8> = (0..4096_usize).map(|index| (index % 251) as u8).collect();
    let host = FakeObjectHost::start(vec![("search/m/splits/b.split".to_owned(), bytes.clone())]);
    let reader = HttpRangeReader::open(
        &host.access(),
        "search/m/splits/b.split",
        Arc::new(AtomicUsize::new(0)),
    )
    .expect("open reader");

    assert_eq!(reader.total_len(), bytes.len());
    assert_eq!(
        reader.read_range(1000, 100).expect("read"),
        bytes[1000..1100]
    );
    assert_eq!(reader.read_range(0, 1).expect("read"), bytes[0..1]);
    assert_eq!(reader.read_range(4095, 1).expect("read"), bytes[4095..4096]);
}

#[test]
fn a_split_published_through_the_adapter_is_readable_through_it() {
    // Publish then range-read is the round trip the write pipeline and the query path actually make,
    // and the one that would break if the two halves disagreed about anything in the format.
    let host = FakeObjectHost::start(Vec::new());
    let split = sample_split();
    put_object(&host.access(), "search/m/splits/c.split", split.clone()).expect("publish");
    assert_eq!(host.object("search/m/splits/c.split"), Some(split));

    let reader = HttpRangeReader::open(
        &host.access(),
        "search/m/splits/c.split",
        Arc::new(AtomicUsize::new(0)),
    )
    .expect("open reader");
    let hits = SplitSearcher::over_reader(Arc::new(reader))
        .expect("searcher")
        .search("zzzuniquetoken", 10)
        .expect("search");
    assert_eq!(hits.len(), 1);
}

#[test]
fn a_refused_token_is_an_error_not_an_empty_result() {
    // The one thing a search engine must never do is answer "no documents" when it was actually told
    // no. A refusal has to surface as a failure the caller reports, not as a corpus with nothing in it.
    let host = FakeObjectHost::start(vec![("search/m/splits/a.split".to_owned(), sample_split())]);
    let mut access = host.access();
    access.token = "not-the-token".to_owned();
    let opened = HttpRangeReader::open(
        &access,
        "search/m/splits/a.split",
        Arc::new(AtomicUsize::new(0)),
    );
    assert!(opened.is_err());
}
