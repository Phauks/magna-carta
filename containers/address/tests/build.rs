//! A whole build against a fake OpenAddresses host and a fake object host: selection, cleaning and
//! de-duplication across sources, the multipart split upload, the manifest, the pointer written last,
//! the published index answering, a failure that leaves the pointer alone, and old builds retired.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::time::{Duration, Instant};

use magna_carta_address::build_job::{run_build, BuildSettings};
use magna_carta_address::current_index::HolderIntervals;
use magna_carta_address::pointer::{AttributionManifest, Pointer};
use magna_carta_address::{Service, Settings};
use serde_json::json;
use support::{feature, get, gzip, post, serve, FakeObjectHost, FakeSourceHost};

const PART_SIZE: usize = 2048;

fn listing() -> serde_json::Value {
    json!([
        { "id": 1, "source": "us/nc/wake", "layer": "addresses", "name": "county", "job": 101, "size": 1 },
        { "id": 2, "source": "us/nc/statewide", "layer": "addresses", "name": "state", "job": 102 },
        { "id": 3, "source": "us/ut/orem", "layer": "addresses", "name": "city", "job": 103 },
        { "id": 4, "source": "us/wa/spokane", "layer": "addresses", "name": "county", "job": 104 },
        { "id": 5, "source": "us/nc/wake", "layer": "parcels", "name": "county", "job": 105 },
        { "id": 6, "source": "ca/on/toronto", "layer": "addresses", "name": "city", "job": 106 },
        { "id": 7, "source": "us/nv/never", "layer": "addresses", "name": "county", "job": null }
    ])
}

fn sources() -> FakeSourceHost {
    let wake = [
        feature("1402", "Lawson Creek Way", "", "Wake Forest", "27587"),
        feature("100", "Main Street", "", "Wake Forest", "27587"),
        "a line that is not a feature".to_owned(),
    ]
    .join("\n");
    // Overlaps the county file, spelled differently: the duplicate is dropped.
    let statewide = [
        feature("1402", "LAWSON CREEK WAY", "", "WAKE FOREST", "27587-1234"),
        feature("7", "Oak Lane", "", "Durham", "27701"),
    ]
    .join("\n");
    let mut orem = vec![feature("1042", "West Center Street", "", "Orem", "84057")];
    for unit in 1..=60 {
        orem.push(feature(
            "1042",
            "W Center St",
            &format!("Apt {unit}"),
            "Orem",
            "84057",
        ));
    }
    let spokane = feature("1", "Excluded Rd", "", "Spokane", "99201");
    FakeSourceHost::start(
        listing(),
        vec![
            (101, gzip(&wake)),
            (102, gzip(&statewide)),
            (103, gzip(&orem.join("\n"))),
            (104, gzip(&spokane)),
        ],
    )
}

fn build_settings(objects: &FakeObjectHost, sources: &FakeSourceHost) -> BuildSettings {
    BuildSettings {
        object_base_url: objects.base_url(),
        source_base_url: sources.base_url(),
        part_size: PART_SIZE,
        options: support::options(),
        scratch_root: std::env::temp_dir(),
    }
}

fn read_pointer(objects: &FakeObjectHost) -> Pointer {
    serde_json::from_slice(&objects.object("us/current.json").expect("a pointer")).unwrap()
}

fn query_service(objects: &FakeObjectHost) -> std::net::SocketAddr {
    serve(Service::new(&Settings {
        object_base_url: objects.base_url(),
        source_base_url: "http://127.0.0.1:9".to_owned(),
        cache_budget_bytes: 16 * 1024 * 1024,
        intervals: HolderIntervals {
            with_index: Duration::from_millis(1),
            without_index: Duration::from_millis(1),
        },
        part_size: PART_SIZE,
        build_options: support::options(),
        scratch_root: std::env::temp_dir(),
    }))
}

fn labels(body: &str) -> Vec<String> {
    let body: serde_json::Value = serde_json::from_str(body).unwrap();
    body["offers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|offer| offer["label"].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn a_build_publishes_four_splits_a_manifest_and_then_the_pointer() {
    let objects = FakeObjectHost::start();
    let sources = sources();
    let outcome = run_build(&build_settings(&objects, &sources)).unwrap();

    let pointer = read_pointer(&objects);
    assert_eq!(pointer, outcome.pointer);
    // Wake 2 + statewide 1 new (one duplicate) + Orem 61; Spokane excluded, parcels and Canada ignored.
    assert_eq!(pointer.document_count, 64);
    assert_eq!(pointer.partitions.len(), 4);
    for key in pointer.partitions.values() {
        assert!(objects.object(key).is_some(), "every partition is uploaded");
        assert!(key.starts_with(&format!("us/{}/", pointer.build)));
    }

    // The manifest credits every included source and records what the policy kept out.
    let manifest: AttributionManifest =
        serde_json::from_slice(&objects.object(&pointer.attribution).unwrap()).unwrap();
    let credited: Vec<(&str, &str, u64)> = manifest
        .sources
        .iter()
        .map(|source| (source.source.as_str(), source.name.as_str(), source.job))
        .collect();
    assert_eq!(
        credited,
        vec![
            ("us/nc/statewide", "state", 102),
            ("us/nc/wake", "county", 101),
            ("us/ut/orem", "city", 103)
        ]
    );
    assert!(manifest
        .sources
        .iter()
        .all(|source| source.layer == "addresses"));
    assert_eq!(manifest.excluded.len(), 1);
    assert_eq!(manifest.excluded[0].source, "us/wa/spokane");
    assert_eq!(manifest.previous_build, None);

    // Every upload is in equal parts but the last, and the pointer is the very last write.
    let part_sizes = objects.part_sizes();
    let west = &part_sizes[&pointer.partitions["west"]];
    assert!(
        west.len() > 1,
        "the test split spans several parts: {west:?}"
    );
    for sizes in part_sizes.values() {
        let (last, rest) = sizes.split_last().unwrap();
        assert!(rest.iter().all(|size| *size == PART_SIZE), "{sizes:?}");
        assert!(*last <= PART_SIZE && *last > 0);
    }
    let writes: Vec<String> = objects
        .requests()
        .into_iter()
        .filter(|request| request.method != "GET" && request.method != "HEAD")
        .map(|request| request.path)
        .collect();
    assert_eq!(writes.last().unwrap(), "/objects/us/current.json");
    let manifest_at = writes
        .iter()
        .position(|path| path.ends_with("attribution.json"))
        .unwrap();
    let last_upload = writes
        .iter()
        .rposition(|path| path.starts_with("/uploads/"))
        .unwrap();
    assert!(last_upload < manifest_at && manifest_at < writes.len() - 1);

    // The published index answers through the query service.
    let address = query_service(&objects);
    let (_, body) = post(
        address,
        "/suggestions",
        r#"{"country":"US","query":"1402 lawson cr"}"#,
    );
    assert_eq!(
        labels(&body),
        vec!["1402 LAWSON CREEK WAY, WAKE FOREST, NC 27587"]
    );
    let (_, body) = post(
        address,
        "/suggestions",
        r#"{"country":"US","query":"1042 w center"}"#,
    );
    let body: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(body["offers"][0]["kind"], "group");
    assert_eq!(body["offers"][0]["count"], 61);
    let (_, body) = post(
        address,
        "/suggestions",
        r#"{"country":"US","query":"1 excluded"}"#,
    );
    assert!(
        labels(&body).is_empty(),
        "an excluded source is not indexed"
    );
}

#[test]
fn a_failed_source_leaves_the_published_index_alone_and_old_builds_are_retired() {
    let objects = FakeObjectHost::start();
    let sources = sources();
    let settings = build_settings(&objects, &sources);
    let first = run_build(&settings).unwrap().pointer;
    let published = objects.object("us/current.json").unwrap();
    let keys_after_first = objects.keys();

    // A source download fails mid-build: nothing is published, and nothing the build uploaded stays.
    sources.fail_job(103);
    let failure = run_build(&settings).unwrap_err();
    assert!(
        failure.0.starts_with("source download failed"),
        "{failure:?}"
    );
    assert!(
        !failure.0.contains("us/"),
        "a failure never names an object key: {failure:?}"
    );
    assert_eq!(objects.object("us/current.json").unwrap(), published);
    assert_eq!(objects.keys(), keys_after_first);
    sources.heal_job(103);

    // Two more builds: the second of them retires the first, and two builds are always kept.
    let second = run_build(&settings).unwrap();
    assert_eq!(
        second.manifest.previous_build.as_deref(),
        Some(first.build.as_str())
    );
    assert!(
        objects.object(&first.attribution).is_some(),
        "the previous build is kept"
    );
    let third = run_build(&settings).unwrap();
    assert_eq!(read_pointer(&objects).build, third.pointer.build);
    for key in first.partitions.values().chain([&first.attribution]) {
        assert!(
            objects.object(key).is_none(),
            "the build before the previous is deleted"
        );
    }
    for key in second.pointer.partitions.values() {
        assert!(objects.object(key).is_some(), "the previous build is kept");
    }
}

#[test]
fn the_build_route_starts_once_and_reports_its_state() {
    let objects = FakeObjectHost::start();
    let sources = sources();
    sources.delay_jobs(Duration::from_millis(300));
    let address = serve(Service::new(&Settings {
        object_base_url: objects.base_url(),
        source_base_url: sources.base_url(),
        cache_budget_bytes: 1024 * 1024,
        intervals: HolderIntervals::default(),
        part_size: PART_SIZE,
        build_options: support::options(),
        scratch_root: std::env::temp_dir(),
    }));

    let (status, body) = get(address, "/builds");
    assert_eq!(status, 200);
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&body).unwrap(),
        json!({ "state": "idle", "startedAt": null, "finishedAt": null, "detail": null })
    );
    assert_eq!(post(address, "/builds", r#"{"country":"CA"}"#).0, 400);
    let (status, body) = post(address, "/builds", r#"{"country":"US"}"#);
    assert_eq!((status, body.as_str()), (202, r#"{"build":"started"}"#));
    let (status, body) = post(address, "/builds", r#"{"country":"US"}"#);
    assert_eq!((status, body.as_str()), (409, r#"{"build":"running"}"#));
    let running: serde_json::Value = serde_json::from_str(&get(address, "/builds").1).unwrap();
    assert_eq!(running["state"], "running");
    assert!(running["startedAt"].as_str().unwrap().ends_with('Z'));

    let deadline = Instant::now() + Duration::from_secs(60);
    let finished = loop {
        let status: serde_json::Value = serde_json::from_str(&get(address, "/builds").1).unwrap();
        if status["state"] != "running" {
            break status;
        }
        assert!(Instant::now() < deadline, "the build did not finish");
        std::thread::sleep(Duration::from_millis(50));
    };
    assert_eq!(finished["state"], "idle", "{finished}");
    assert!(finished["finishedAt"].is_string());
    assert!(objects.object("us/current.json").is_some());

    // A failing build reports itself, in engine words.
    sources.fail_job(101);
    sources.delay_jobs(Duration::ZERO);
    assert_eq!(post(address, "/builds", r#"{"country":"US"}"#).0, 202);
    let deadline = Instant::now() + Duration::from_secs(60);
    let failed = loop {
        let status: serde_json::Value = serde_json::from_str(&get(address, "/builds").1).unwrap();
        if status["state"] != "running" {
            break status;
        }
        assert!(Instant::now() < deadline, "the build did not finish");
        std::thread::sleep(Duration::from_millis(50));
    };
    assert_eq!(failed["state"], "failed");
    assert!(failed["detail"]
        .as_str()
        .unwrap()
        .starts_with("source download failed"));
}
