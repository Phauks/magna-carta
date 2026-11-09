//! The HTTP surface: the wire contract the address worker forwards to, end to end over real sockets.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::time::Duration;

use magna_carta_address::current_index::HolderIntervals;
use magna_carta_address::{Service, Settings};
use serde_json::Value;
use support::{feature, get, post, publish_build, serve, FakeObjectHost};

fn settings(host: &FakeObjectHost) -> Settings {
    Settings {
        object_base_url: host.base_url(),
        source_base_url: "http://127.0.0.1:9".to_owned(),
        cache_budget_bytes: 16 * 1024 * 1024,
        intervals: HolderIntervals {
            with_index: Duration::from_secs(600),
            without_index: Duration::from_millis(1),
        },
        part_size: 4096,
        build_options: support::options(),
        scratch_root: std::env::temp_dir(),
    }
}

fn published_host() -> FakeObjectHost {
    let host = FakeObjectHost::start();
    let mut lines = vec![
        feature("1402", "Lawson Creek Way", "", "Wake Forest", "27587"),
        feature("1042", "W Center St", "", "Raleigh", "27601"),
    ];
    for unit in ["1", "2", "10", "3"] {
        lines.push(feature(
            "1042",
            "W Center St",
            &format!("Apt {unit}"),
            "Raleigh",
            "27601",
        ));
    }
    publish_build(&host, "b1", &lines);
    host
}

fn json(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
}

#[test]
fn ready_answers_no_content() {
    let host = FakeObjectHost::start();
    let address = serve(Service::new(&settings(&host)));
    assert_eq!(get(address, "/ready").0, 204);
}

#[test]
fn suggestions_answer_in_the_wire_shape() {
    let host = published_host();
    let address = serve(Service::new(&settings(&host)));
    let (status, body) = post(
        address,
        "/suggestions",
        r#"{"country":"US","query":"1402 lawson cr","limit":8,"near":"NC"}"#,
    );
    assert_eq!(status, 200);
    let body = json(&body);
    assert_eq!(body["outcome"], "suggestions");
    let offer = &body["offers"][0];
    assert_eq!(offer["kind"], "address");
    assert_eq!(
        offer["label"],
        "1402 LAWSON CREEK WAY, WAKE FOREST, NC 27587"
    );
    let fields: Vec<&str> = offer["address"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        fields.len(),
        8,
        "number, street, unit, city, region, postcode, longitude, latitude: {fields:?}"
    );
    assert_eq!(offer["address"]["unit"], "");
    assert!(offer["address"]["longitude"].is_f64());

    // A group, with its building and exact count.
    let (_, body) = post(
        address,
        "/suggestions",
        r#"{"country":"US","query":"1042 w cen"}"#,
    );
    let group = &json(&body)["offers"][0];
    assert_eq!(group["kind"], "group");
    assert_eq!(group["count"], 5);
    assert_eq!(group["label"], "1042 W CENTER ST, RALEIGH, NC 27601");
    assert_eq!(group["building"]["postcode"], "27601");
    assert!(group["building"].get("unit").is_none());

    // Text that is not an address being typed is an empty list, not an error.
    let (status, body) = post(
        address,
        "/suggestions",
        r#"{"country":"US","query":"lawson"}"#,
    );
    assert_eq!(status, 200);
    assert_eq!(
        json(&body),
        serde_json::json!({ "outcome": "suggestions", "offers": [] })
    );
}

#[test]
fn units_open_a_building_in_order() {
    let host = published_host();
    let address = serve(Service::new(&settings(&host)));
    let (status, body) = post(
        address,
        "/units",
        r#"{"country":"US","building":{"number":"1042","street":"W CENTER ST","city":"RALEIGH","region":"NC","postcode":"27601"}}"#,
    );
    assert_eq!(status, 200);
    let body = json(&body);
    assert_eq!(body["outcome"], "units");
    let units: Vec<&str> = body["addresses"]
        .as_array()
        .unwrap()
        .iter()
        .map(|address| address["unit"].as_str().unwrap())
        .collect();
    assert_eq!(units, vec!["", "1", "2", "3", "10"]);
}

#[test]
fn another_country_has_no_coverage() {
    let host = published_host();
    let address = serve(Service::new(&settings(&host)));
    let (status, body) = post(
        address,
        "/suggestions",
        r#"{"country":"CA","query":"12 main"}"#,
    );
    assert_eq!(status, 200);
    assert_eq!(json(&body), serde_json::json!({ "outcome": "no-coverage" }));
    let (_, body) = post(
        address,
        "/units",
        r#"{"country":"GB","building":{"number":"1","street":"HIGH ST","city":"","region":"","postcode":""}}"#,
    );
    assert_eq!(json(&body), serde_json::json!({ "outcome": "no-coverage" }));
}

#[test]
fn without_a_published_index_the_answer_is_unavailable() {
    let host = FakeObjectHost::start();
    let address = serve(Service::new(&settings(&host)));
    let (status, body) = post(
        address,
        "/suggestions",
        r#"{"country":"US","query":"12 main"}"#,
    );
    assert_eq!(status, 200);
    assert_eq!(json(&body), serde_json::json!({ "outcome": "unavailable" }));
    let (_, body) = post(
        address,
        "/units",
        r#"{"country":"US","building":{"number":"1","street":"MAIN ST","city":"","region":"NC","postcode":""}}"#,
    );
    assert_eq!(json(&body), serde_json::json!({ "outcome": "unavailable" }));

    // Published later: picked up on the next due re-read.
    publish_build(
        &host,
        "b1",
        &[feature("12", "Main St", "", "Cary", "27511")],
    );
    std::thread::sleep(Duration::from_millis(5));
    let (_, body) = post(
        address,
        "/suggestions",
        r#"{"country":"US","query":"12 main"}"#,
    );
    assert_eq!(json(&body)["outcome"], "suggestions");
}

#[test]
fn a_partition_that_cannot_be_read_is_unavailable_not_an_error() {
    let host = published_host();
    host.put("us/b1/south.split", vec![0_u8; 3]);
    let address = serve(Service::new(&settings(&host)));
    let (status, body) = post(
        address,
        "/suggestions",
        r#"{"country":"US","query":"1402 lawson"}"#,
    );
    assert_eq!(status, 200);
    assert_eq!(json(&body), serde_json::json!({ "outcome": "unavailable" }));
}

#[test]
fn invalid_requests_are_refused_without_echoing_them() {
    let host = published_host();
    let address = serve(Service::new(&settings(&host)));
    let secret = "1402 lawson creek way secretive";
    let long = format!(r#"{{"country":"US","query":"{}"}}"#, "9".repeat(500));
    for (body, word) in [
        (
            format!(r#"{{"country":"USA","query":"{secret}"}}"#),
            "invalid-country",
        ),
        (
            format!(r#"{{"country":"US","query":"{secret}","limit":11}}"#),
            "invalid-limit",
        ),
        (
            format!(r#"{{"country":"US","query":"{secret}","limit":0}}"#),
            "invalid-limit",
        ),
        (
            format!(r#"{{"country":"US","query":"{secret}","near":"Carolina"}}"#),
            "invalid-near",
        ),
        (
            format!(r#"{{"country":"US","query":{{"text":"{secret}"}}}}"#),
            "invalid-body",
        ),
        (
            format!(r#"{{"country":"US","query":"{secret}""#),
            "invalid-body",
        ),
        (long, "query-too-long"),
    ] {
        let (status, answer) = post(address, "/suggestions", &body);
        assert_eq!(status, 400, "{body}");
        assert_eq!(json(&answer), serde_json::json!({ "error": word }));
        assert!(!answer.contains("secretive") && !answer.contains("lawson"));
    }
    let (status, answer) = post(
        address,
        "/units",
        &format!(
            r#"{{"country":"US","building":{{"number":"","street":"{secret}","city":"","region":"NC","postcode":""}}}}"#
        ),
    );
    assert_eq!(status, 400);
    assert_eq!(
        json(&answer),
        serde_json::json!({ "error": "invalid-building" })
    );
}

#[test]
fn the_query_path_never_writes() {
    let host = published_host();
    let address = serve(Service::new(&settings(&host)));
    host.clear_requests();
    post(
        address,
        "/suggestions",
        r#"{"country":"US","query":"1402 lawson"}"#,
    );
    post(
        address,
        "/units",
        r#"{"country":"US","building":{"number":"1042","street":"W CENTER ST","city":"RALEIGH","region":"NC","postcode":"27601"}}"#,
    );
    for request in host.requests() {
        assert!(
            request.method == "HEAD" || request.method == "GET",
            "the query path made a {} request",
            request.method
        );
        assert!(request.path.starts_with("/objects/"));
        assert!(request.range.is_some() || request.whole || request.method == "HEAD");
    }
}
