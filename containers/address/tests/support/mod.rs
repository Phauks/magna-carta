//! Fakes of the two intercepted hosts, served over real sockets, and fixtures to fill them.
//!
//! The object-host fake follows the address worker's contract: HEAD answers `x-mc-object-size` and
//! `content-length`; a GET needs a closed `Range` (or `x-mc-whole: small` for an object up to 1 MiB) and
//! is otherwise refused with 416; a multipart part needs a content-length; refusals are
//! `{"error":"<word>"}`. Every request is logged so a test can assert what left the process.

// Shared by several test binaries, each of which uses part of it; and these helpers are plain functions
// the test exemption in containers/clippy.toml does not reach. A fake that fails to stand up is a failed
// test, not an abort on somebody else's bytes.
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::io::Write;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use address_core::{build_partition_split, parse_feature_line, Address, BuildOptions, Partition};
use magna_carta_address::pointer::{attribution_key, pointer_key, split_key, Pointer};
use magna_carta_address::{router, Service};

/// One request the fake saw.
#[derive(Clone, Debug)]
pub struct SeenRequest {
    pub method: String,
    pub path: String,
    pub range: Option<String>,
    pub whole: bool,
    pub content_length: Option<usize>,
}

#[derive(Default)]
struct Upload {
    key: String,
    parts: BTreeMap<u32, Vec<u8>>,
}

#[derive(Default)]
struct HostState {
    objects: BTreeMap<String, Vec<u8>>,
    uploads: HashMap<String, Upload>,
    seen: Vec<SeenRequest>,
    /// Every part size received, per object key, in part order.
    part_sizes: BTreeMap<String, Vec<usize>>,
    next_upload: usize,
}

pub struct FakeObjectHost {
    pub address: SocketAddr,
    state: Arc<Mutex<HostState>>,
}

fn header_value(request: &tiny_http::Request, name: &str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|header| header.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|header| header.value.as_str().to_owned())
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap();
            output.push(u8::from_str_radix(hex, 16).unwrap());
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(output).unwrap()
}

fn query_parameter(query: &str, name: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == name).then(|| percent_decode(value))
    })
}

fn json_response(status: u16, body: &str) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    tiny_http::Response::from_string(body)
        .with_status_code(status)
        .with_header(tiny_http::Header::from_bytes("content-type", "application/json").unwrap())
}

fn refusal(status: u16, word: &str) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    json_response(status, &format!(r#"{{"error":"{word}"}}"#))
}

const SMALL_LIMIT: usize = 1024 * 1024;

impl FakeObjectHost {
    pub fn start() -> Self {
        let server = tiny_http::Server::http("127.0.0.1:0").expect("bind fake object host");
        let address = match server.server_addr() {
            tiny_http::ListenAddr::IP(address) => address,
            other => panic!("unexpected listen address {other:?}"),
        };
        let state = Arc::new(Mutex::new(HostState::default()));
        let shared = state.clone();
        thread::spawn(move || {
            for request in server.incoming_requests() {
                let shared = shared.clone();
                // One thread per request, as the real host serves concurrently.
                thread::spawn(move || handle(request, &shared));
            }
        });
        Self { address, state }
    }

    pub fn base_url(&self) -> String {
        format!("http://{}", self.address)
    }

    pub fn put(&self, key: &str, bytes: Vec<u8>) {
        self.state
            .lock()
            .unwrap()
            .objects
            .insert(key.to_owned(), bytes);
    }

    pub fn object(&self, key: &str) -> Option<Vec<u8>> {
        self.state.lock().unwrap().objects.get(key).cloned()
    }

    pub fn keys(&self) -> BTreeSet<String> {
        self.state.lock().unwrap().objects.keys().cloned().collect()
    }

    pub fn requests(&self) -> Vec<SeenRequest> {
        self.state.lock().unwrap().seen.clone()
    }

    pub fn clear_requests(&self) {
        self.state.lock().unwrap().seen.clear();
    }

    pub fn part_sizes(&self) -> BTreeMap<String, Vec<usize>> {
        self.state.lock().unwrap().part_sizes.clone()
    }
}

fn handle(mut request: tiny_http::Request, state: &Mutex<HostState>) {
    let method = request.method().as_str().to_owned();
    let url = request.url().to_owned();
    let (path, query) = url.split_once('?').unwrap_or((url.as_str(), ""));
    let path = path.to_owned();
    let query = query.to_owned();
    let range = header_value(&request, "range");
    let whole = header_value(&request, "x-mc-whole").as_deref() == Some("small");
    let content_length =
        header_value(&request, "content-length").and_then(|value| value.parse().ok());
    let mut body = Vec::new();
    let _ = request.as_reader().read_to_end(&mut body);
    state.lock().unwrap().seen.push(SeenRequest {
        method: method.clone(),
        path: path.clone(),
        range: range.clone(),
        whole,
        content_length,
    });

    if let Some(key) = path.strip_prefix("/objects/") {
        let key = key.to_owned();
        match method.as_str() {
            "HEAD" => {
                let size = state.lock().unwrap().objects.get(&key).map(Vec::len);
                match size {
                    // tiny_http derives content-length from the body and omits the body for a HEAD.
                    Some(size) => {
                        let _ = request.respond(
                            tiny_http::Response::from_data(vec![0_u8; size]).with_header(
                                tiny_http::Header::from_bytes("x-mc-object-size", size.to_string())
                                    .unwrap(),
                            ),
                        );
                    }
                    None => {
                        let _ = request.respond(refusal(404, "not-found"));
                    }
                }
            }
            "GET" => {
                let object = state.lock().unwrap().objects.get(&key).cloned();
                let Some(object) = object else {
                    let _ = request.respond(refusal(404, "not-found"));
                    return;
                };
                if whole && range.is_none() {
                    if object.len() > SMALL_LIMIT {
                        let _ = request.respond(refusal(413, "too-large"));
                    } else {
                        let _ = request.respond(tiny_http::Response::from_data(object));
                    }
                    return;
                }
                let Some((first, last)) = range.as_deref().and_then(|header| {
                    let (first, last) = header.strip_prefix("bytes=")?.split_once('-')?;
                    Some((first.parse::<usize>().ok()?, last.parse::<usize>().ok()?))
                }) else {
                    let _ = request.respond(refusal(416, "range-required"));
                    return;
                };
                if first >= object.len() || last < first {
                    let _ = request.respond(refusal(416, "range-not-satisfiable"));
                    return;
                }
                let end = last.min(object.len() - 1);
                let _ = request.respond(
                    tiny_http::Response::from_data(object[first..=end].to_vec())
                        .with_status_code(206),
                );
            }
            "PUT" => {
                if body.len() > SMALL_LIMIT {
                    let _ = request.respond(refusal(413, "too-large"));
                    return;
                }
                state.lock().unwrap().objects.insert(key, body);
                let _ = request.respond(json_response(200, "{}"));
            }
            "DELETE" => {
                let removed = state.lock().unwrap().objects.remove(&key);
                let status = if removed.is_some() { 204 } else { 404 };
                let _ = request.respond(tiny_http::Response::empty(status));
            }
            _ => {
                let _ = request.respond(refusal(405, "method-not-allowed"));
            }
        }
        return;
    }

    if let Some(rest) = path.strip_prefix("/uploads/") {
        if let Some(key) = rest.strip_suffix("/complete") {
            let upload_id = query_parameter(&query, "uploadId").unwrap_or_default();
            let mut guard = state.lock().unwrap();
            let Some(upload) = guard.uploads.remove(&upload_id) else {
                drop(guard);
                let _ = request.respond(refusal(404, "no-such-upload"));
                return;
            };
            assert_eq!(upload.key, key);
            let listed: serde_json::Value = serde_json::from_slice(&body).unwrap();
            let mut assembled = Vec::new();
            let mut sizes = Vec::new();
            for (position, part) in listed["parts"].as_array().unwrap().iter().enumerate() {
                let number = u32::try_from(part["part"].as_u64().unwrap()).unwrap();
                assert_eq!(number as usize, position + 1, "parts are listed in order");
                assert_eq!(part["etag"].as_str().unwrap(), format!("etag-{number}"));
                let bytes = &upload.parts[&number];
                sizes.push(bytes.len());
                assembled.extend_from_slice(bytes);
            }
            guard.objects.insert(key.to_owned(), assembled);
            guard.part_sizes.insert(key.to_owned(), sizes);
            drop(guard);
            let _ = request.respond(tiny_http::Response::empty(204));
            return;
        }
        let key = rest.to_owned();
        match method.as_str() {
            "POST" => {
                let mut guard = state.lock().unwrap();
                guard.next_upload += 1;
                // Characters that must be encoded in a query string, as real upload ids carry them.
                let upload_id = format!("upload+{}/id=", guard.next_upload);
                guard.uploads.insert(
                    upload_id.clone(),
                    Upload {
                        key,
                        parts: BTreeMap::new(),
                    },
                );
                drop(guard);
                let _ = request.respond(json_response(
                    200,
                    &serde_json::json!({ "uploadId": upload_id }).to_string(),
                ));
            }
            "PUT" => {
                if content_length.is_none() {
                    let _ = request.respond(refusal(411, "length-required"));
                    return;
                }
                let upload_id = query_parameter(&query, "uploadId").unwrap_or_default();
                let part: u32 = query_parameter(&query, "part")
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(0);
                let mut guard = state.lock().unwrap();
                let Some(upload) = guard.uploads.get_mut(&upload_id) else {
                    drop(guard);
                    let _ = request.respond(refusal(404, "no-such-upload"));
                    return;
                };
                upload.parts.insert(part, body);
                drop(guard);
                let _ =
                    request.respond(json_response(200, &format!(r#"{{"etag":"etag-{part}"}}"#)));
            }
            _ => {
                let _ = request.respond(refusal(405, "method-not-allowed"));
            }
        }
        return;
    }
    let _ = request.respond(refusal(404, "not-found"));
}

/// A fake OpenAddresses host: the source list and gzip job outputs. A job listed in `failing` answers
/// 502, the way the worker answers when the upstream download fails.
pub struct FakeSourceHost {
    pub address: SocketAddr,
    failing: Arc<Mutex<BTreeSet<u64>>>,
    delay: Arc<Mutex<Duration>>,
}

pub fn gzip(text: &str) -> Vec<u8> {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(text.as_bytes()).unwrap();
    encoder.finish().unwrap()
}

impl FakeSourceHost {
    pub fn start(listing: serde_json::Value, jobs: Vec<(u64, Vec<u8>)>) -> Self {
        let server = tiny_http::Server::http("127.0.0.1:0").expect("bind fake source host");
        let address = match server.server_addr() {
            tiny_http::ListenAddr::IP(address) => address,
            other => panic!("unexpected listen address {other:?}"),
        };
        let failing = Arc::new(Mutex::new(BTreeSet::new()));
        let delay = Arc::new(Mutex::new(Duration::ZERO));
        let jobs: HashMap<u64, Vec<u8>> = jobs.into_iter().collect();
        let listing = listing.to_string();
        let failing_jobs = failing.clone();
        let job_delay = delay.clone();
        thread::spawn(move || {
            for request in server.incoming_requests() {
                let url = request.url().to_owned();
                if url.contains('?') {
                    let _ = request.respond(refusal(400, "query-refused"));
                    continue;
                }
                if url == "/api/data" {
                    let _ = request.respond(json_response(200, &listing));
                    continue;
                }
                let job = url
                    .strip_prefix("/job/")
                    .and_then(|rest| rest.strip_suffix("/source.geojson.gz"))
                    .and_then(|digits| digits.parse::<u64>().ok());
                match job {
                    Some(job) if failing_jobs.lock().unwrap().contains(&job) => {
                        let _ = request.respond(refusal(502, "upstream-error"));
                    }
                    Some(job) if jobs.contains_key(&job) => {
                        thread::sleep(*job_delay.lock().unwrap());
                        let _ = request.respond(tiny_http::Response::from_data(jobs[&job].clone()));
                    }
                    _ => {
                        let _ = request.respond(refusal(404, "not-found"));
                    }
                }
            }
        });
        Self {
            address,
            failing,
            delay,
        }
    }

    pub fn base_url(&self) -> String {
        format!("http://{}", self.address)
    }

    pub fn fail_job(&self, job: u64) {
        self.failing.lock().unwrap().insert(job);
    }

    pub fn heal_job(&self, job: u64) {
        self.failing.lock().unwrap().remove(&job);
    }

    pub fn delay_jobs(&self, delay: Duration) {
        *self.delay.lock().unwrap() = delay;
    }
}

/// A GeoJSON feature line.
pub fn feature(number: &str, street: &str, unit: &str, city: &str, postcode: &str) -> String {
    serde_json::json!({
        "type": "Feature",
        "properties": {
            "number": number, "street": street, "unit": unit, "city": city,
            "district": "", "region": "", "postcode": postcode, "hash": ""
        },
        "geometry": { "type": "Point", "coordinates": [-78.51, 35.97] }
    })
    .to_string()
}

pub fn options() -> BuildOptions {
    BuildOptions {
        threads: 1,
        heap_bytes: 30_000_000,
    }
}

/// A split of `lines` (GeoJSON features) for `state`.
pub fn split_of(state: &str, lines: &[String]) -> Vec<u8> {
    let rows: Vec<Address> = lines
        .iter()
        .filter_map(|line| parse_feature_line(line, state))
        .collect();
    let scratch = tempfile::tempdir().unwrap();
    build_partition_split(rows, scratch.path(), &options()).unwrap()
}

/// Publish a whole build on the fake host by hand: four splits (the South one holding `south_lines`
/// as North Carolina, the rest empty), a manifest and a pointer.
pub fn publish_build(host: &FakeObjectHost, build: &str, south_lines: &[String]) {
    let mut partitions = BTreeMap::new();
    for partition in Partition::ALL {
        let lines: &[String] = if partition == Partition::South {
            south_lines
        } else {
            &[]
        };
        let key = split_key(build, partition);
        host.put(&key, split_of("NC", lines));
        partitions.insert(partition.name().to_owned(), key);
    }
    let attribution = attribution_key(build);
    host.put(
        &attribution,
        serde_json::to_vec(&serde_json::json!({
            "build": build, "builtAt": "2026-10-02T00:00:00Z", "previousBuild": null, "sources": []
        }))
        .unwrap(),
    );
    let pointer = Pointer {
        build: build.to_owned(),
        built_at: "2026-10-02T00:00:00Z".to_owned(),
        document_count: south_lines.len() as u64,
        partitions,
        attribution,
    };
    host.put(&pointer_key(), serde_json::to_vec(&pointer).unwrap());
}

/// Serve the router on a local port from a background runtime.
pub fn serve(service: Service) -> SocketAddr {
    let (sender, receiver) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async move {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            sender.send(listener.local_addr().unwrap()).unwrap();
            axum::serve(listener, router(service)).await.unwrap();
        });
    });
    receiver.recv().unwrap()
}

/// A client that reads every status as an answer.
pub fn client() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .build()
        .into()
}

/// POST `body` to `path` on the service; the status and the body as JSON (null when empty).
pub fn post(address: SocketAddr, path: &str, body: &str) -> (u16, String) {
    let response = client()
        .post(&format!("http://{address}{path}"))
        .header("content-type", "application/json")
        .send(body.as_bytes())
        .unwrap();
    let status = response.status().as_u16();
    let text = response.into_body().read_to_string().unwrap();
    (status, text)
}

pub fn get(address: SocketAddr, path: &str) -> (u16, String) {
    let response = client()
        .get(&format!("http://{address}{path}"))
        .call()
        .unwrap();
    let status = response.status().as_u16();
    let text = response.into_body().read_to_string().unwrap();
    (status, text)
}
