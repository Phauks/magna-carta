//! The range reader, its cache, and the pointer reload, against a real object host over a real socket.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use address_core::Offer;
use magna_carta_address::current_index::{HolderIntervals, IndexHolder};
use magna_carta_address::object_client::{
    CachedRangeReader, HttpRangeReader, ObjectStore, ObjectWriter, RangeCache,
};
use search_core::RangeReader;
use support::{feature, publish_build, FakeObjectHost};

#[test]
fn a_range_read_returns_exactly_the_bytes_asked_for_and_a_head_finds_the_size() {
    let host = FakeObjectHost::start();
    let bytes: Vec<u8> = (0..4096_usize).map(|index| (index % 251) as u8).collect();
    host.put("us/b1/south.split", bytes.clone());
    let store = ObjectStore::new(&host.base_url());
    let reader =
        HttpRangeReader::open(&store, "us/b1/south.split", Arc::new(AtomicUsize::new(0))).unwrap();
    assert_eq!(reader.total_len(), 4096);
    assert_eq!(reader.read_range(1000, 100).unwrap(), bytes[1000..1100]);
    assert_eq!(reader.read_range(4095, 1).unwrap(), bytes[4095..4096]);
    // Past the end the host truncates; the reader refuses a short answer rather than passing it on.
    assert!(reader.read_range(4000, 200).is_err());
    assert!(reader.read_range(5000, 10).is_err());
    assert!(
        HttpRangeReader::open(&store, "us/b1/absent.split", Arc::new(AtomicUsize::new(0))).is_err()
    );

    let requests = host.requests();
    assert_eq!(requests[0].method, "HEAD");
    for request in requests.iter().filter(|request| request.method == "GET") {
        assert!(
            request.range.is_some(),
            "a split is only ever read by range"
        );
        assert!(!request.whole);
    }
}

#[test]
fn a_cached_read_is_served_once_and_shared_across_readers() {
    let host = FakeObjectHost::start();
    host.put("us/b1/south.split", vec![7_u8; 10_000]);
    let store = ObjectStore::new(&host.base_url());
    let cache = RangeCache::new(1024 * 1024);
    let reads = Arc::new(AtomicUsize::new(0));
    let first = CachedRangeReader::new(
        HttpRangeReader::open(&store, "us/b1/south.split", reads.clone()).unwrap(),
        cache.clone(),
    );
    let second = CachedRangeReader::new(
        HttpRangeReader::open(&store, "us/b1/south.split", reads.clone()).unwrap(),
        cache.clone(),
    );
    host.clear_requests();
    for _ in 0..3 {
        assert_eq!(first.read_range(100, 50).unwrap(), vec![7_u8; 50]);
        assert_eq!(second.read_range(100, 50).unwrap(), vec![7_u8; 50]);
    }
    assert_eq!(first.read_range(200, 50).unwrap().len(), 50);
    let gets = host
        .requests()
        .iter()
        .filter(|request| request.method == "GET")
        .count();
    assert_eq!(gets, 2, "two distinct ranges, two requests");
    let statistics = cache.statistics();
    assert_eq!(statistics.misses, 2);
    assert_eq!(statistics.hits, 5);
    assert_eq!(statistics.bytes, 100);
}

#[test]
fn small_objects_are_read_whole_and_written_by_the_writer_only() {
    let host = FakeObjectHost::start();
    let store = ObjectStore::new(&host.base_url());
    let writer = ObjectWriter::new(&host.base_url());
    assert_eq!(store.get_small("us/current.json").unwrap(), None);
    writer.put_small("us/current.json", br#"{"a":1}"#).unwrap();
    assert_eq!(
        store.get_small("us/current.json").unwrap().as_deref(),
        Some(&br#"{"a":1}"#[..])
    );
    assert!(host.requests().iter().any(|request| request.whole));
    writer.delete("us/current.json").unwrap();
    writer.delete("us/current.json").unwrap();
    assert!(host.object("us/current.json").is_none());
    assert!(writer
        .put_small("big", &vec![0_u8; 2 * 1024 * 1024])
        .is_err());
}

#[test]
fn a_multipart_upload_sends_equal_parts_and_assembles_the_object() {
    let host = FakeObjectHost::start();
    let writer = ObjectWriter::new(&host.base_url());
    let bytes: Vec<u8> = (0..10_000_usize).map(|index| (index % 239) as u8).collect();
    let mut upload = writer.multipart("us/b1/west.split", 4096).unwrap();
    // Written in odd-sized pieces, as a split streams.
    for piece in bytes.chunks(777) {
        std::io::Write::write_all(&mut upload, piece).unwrap();
    }
    std::io::Write::flush(&mut upload).unwrap();
    assert_eq!(upload.finish().unwrap(), 10_000);
    assert_eq!(host.object("us/b1/west.split").unwrap(), bytes);
    assert_eq!(
        host.part_sizes()["us/b1/west.split"],
        vec![4096, 4096, 1808]
    );
    assert!(host
        .requests()
        .iter()
        .filter(|request| request.method == "PUT")
        .all(|request| request.content_length.is_some()));
}

#[test]
fn a_part_exactly_filling_the_upload_needs_no_empty_last_part() {
    let host = FakeObjectHost::start();
    let writer = ObjectWriter::new(&host.base_url());
    let mut upload = writer.multipart("us/b1/exact.split", 100).unwrap();
    std::io::Write::write_all(&mut upload, &[1_u8; 200]).unwrap();
    upload.finish().unwrap();
    assert_eq!(host.part_sizes()["us/b1/exact.split"], vec![100, 100]);
}

fn first_label(offers: &[Offer]) -> String {
    match &offers[0] {
        Offer::Address { label, .. } | Offer::Group { label, .. } => label.clone(),
    }
}

#[test]
fn the_pointer_is_reread_on_its_interval_and_the_index_reopened_only_on_a_new_build() {
    let host = FakeObjectHost::start();
    let holder = IndexHolder::new(
        ObjectStore::new(&host.base_url()),
        RangeCache::new(64 * 1024 * 1024),
        HolderIntervals {
            with_index: Duration::from_millis(300),
            without_index: Duration::from_millis(100),
        },
    );

    // Nothing published: no index.
    assert!(holder.current().is_none());

    publish_build(
        &host,
        "b1",
        &[feature(
            "1402",
            "Lawson Creek Way",
            "",
            "Wake Forest",
            "27587",
        )],
    );
    // Not due yet: the missing pointer was checked a moment ago.
    assert!(holder.current().is_none());
    thread::sleep(Duration::from_millis(150));
    let first = holder.current().expect("published");
    assert_eq!(first.build, "b1");
    let offers = first.engine.suggest("1402 lawson", 8, None).unwrap();
    assert_eq!(
        first_label(&offers),
        "1402 LAWSON CREEK WAY, WAKE FOREST, NC 27587"
    );

    // A new build is published; the open index is kept until the interval passes.
    publish_build(
        &host,
        "b2",
        &[feature("77", "Elm Street", "", "Raleigh", "27601")],
    );
    assert_eq!(holder.current().unwrap().build, "b1");
    thread::sleep(Duration::from_millis(350));
    let second = holder.current().unwrap();
    assert_eq!(second.build, "b2");
    assert!(!second.engine.suggest("77 elm", 8, None).unwrap().is_empty());

    // A re-read that finds the same build costs the pointer GET and nothing else.
    thread::sleep(Duration::from_millis(350));
    host.clear_requests();
    let same = holder.current().unwrap();
    assert!(Arc::ptr_eq(&same, &second));
    let requests = host.requests();
    assert_eq!(requests.len(), 1, "{requests:?}");
    assert!(requests[0].whole);

    // A malformed pointer is a failed read, not an unpublished index.
    host.put("us/current.json", b"not json".to_vec());
    thread::sleep(Duration::from_millis(350));
    assert_eq!(
        holder.current().unwrap().build,
        "b2",
        "an unreadable pointer keeps the open index"
    );
}
