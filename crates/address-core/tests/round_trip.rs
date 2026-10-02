//! Build -> split bytes -> `SplitDirectory` over a range reader -> answers.
//!
//! Every test here goes through the same path production does: rows are parsed and cleaned from GeoJSON
//! lines, de-duplicated, indexed per partition, streamed out as a `search-core` split, and opened again
//! through a range reader that counts what it serves. Nothing reaches into the index directly, so a
//! change to the split format, the schema or the query shows up as a wrong answer here.

// The helpers below are plain functions, which the test exemption in crates/clippy.toml does not
// reach; a fixture that fails to build is a failed test, not an abort on somebody else's bytes.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::{BTreeMap, HashMap};
use std::io;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use address_core::{
    build_partition_split, parse_feature_line, state_of_source, Address, AddressEngine,
    BuildOptions, Building, Deduplicator, Offer, Partition, PartitionIndex,
};
use search_core::RangeReader;

/// Bytes already served, by `(offset, length)`.
type ServedRanges = Mutex<HashMap<(usize, usize), Vec<u8>>>;

/// An in-memory split that counts every read, and optionally keeps what it served so a repeated read
/// is free — the shape of the query container's cache.
#[derive(Debug)]
struct CountingReader {
    bytes: Vec<u8>,
    reads: AtomicUsize,
    cache: Option<ServedRanges>,
}

impl CountingReader {
    fn new(bytes: Vec<u8>, caching: bool) -> Arc<Self> {
        Arc::new(Self {
            bytes,
            reads: AtomicUsize::new(0),
            cache: caching.then(|| Mutex::new(HashMap::new())),
        })
    }

    fn take_reads(&self) -> usize {
        self.reads.swap(0, Ordering::SeqCst)
    }
}

impl RangeReader for CountingReader {
    fn read_range(&self, offset: usize, length: usize) -> io::Result<Vec<u8>> {
        if let Some(cache) = &self.cache {
            if let Some(bytes) = cache.lock().unwrap().get(&(offset, length)) {
                return Ok(bytes.clone());
            }
        }
        let end = offset
            .checked_add(length)
            .filter(|end| *end <= self.bytes.len())
            .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "past the end"))?;
        self.reads.fetch_add(1, Ordering::SeqCst);
        let bytes = self.bytes[offset..end].to_vec();
        if let Some(cache) = &self.cache {
            cache
                .lock()
                .unwrap()
                .insert((offset, length), bytes.clone());
        }
        Ok(bytes)
    }

    fn total_len(&self) -> usize {
        self.bytes.len()
    }
}

const FIXTURES: &[(&str, &str)] = &[
    (
        "us/nc/sample",
        include_str!("fixtures/us_nc_sample.geojson"),
    ),
    (
        "us/ut/sample",
        include_str!("fixtures/us_ut_sample.geojson"),
    ),
    (
        "us/nv/sample",
        include_str!("fixtures/us_nv_sample.geojson"),
    ),
    (
        "us/ny/sample",
        include_str!("fixtures/us_ny_sample.geojson"),
    ),
];

/// Every fixture row, parsed, cleaned and de-duplicated, grouped by partition.
fn partitioned_rows() -> BTreeMap<Partition, Vec<Address>> {
    let mut deduplicator = Deduplicator::new();
    let mut partitions: BTreeMap<Partition, Vec<Address>> = Partition::ALL
        .into_iter()
        .map(|partition| (partition, Vec::new()))
        .collect();
    for (source, text) in FIXTURES {
        let state = state_of_source(source).unwrap();
        for line in text.lines() {
            if let Some(address) = parse_feature_line(line, &state) {
                if deduplicator.admit(&address) {
                    partitions
                        .entry(Partition::for_state(&state))
                        .or_default()
                        .push(address);
                }
            }
        }
    }
    partitions
}

fn test_options() -> BuildOptions {
    BuildOptions {
        threads: 2,
        heap_bytes: 60_000_000,
    }
}

struct Opened {
    engine: AddressEngine,
    readers: Vec<Arc<CountingReader>>,
}

impl Opened {
    fn take_reads(&self) -> usize {
        self.readers.iter().map(|reader| reader.take_reads()).sum()
    }
}

fn open_all(caching: bool) -> Opened {
    let mut partitions = Vec::new();
    let mut readers = Vec::new();
    for (partition, rows) in partitioned_rows() {
        let scratch = tempfile::tempdir().unwrap();
        let split = build_partition_split(rows, scratch.path(), &test_options()).unwrap();
        let reader = CountingReader::new(split, caching);
        partitions.push(PartitionIndex::open(partition, reader.clone()).unwrap());
        readers.push(reader);
    }
    Opened {
        engine: AddressEngine::new(partitions),
        readers,
    }
}

fn labels(offers: &[Offer]) -> Vec<String> {
    offers
        .iter()
        .map(|offer| match offer {
            Offer::Address { label, .. } | Offer::Group { label, .. } => label.clone(),
        })
        .collect()
}

#[test]
fn cleaning_and_deduplication_shape_what_is_indexed() {
    let rows = partitioned_rows();
    let south = &rows[&Partition::South];
    // Thirteen lines: one duplicate (a ZIP+4 spelling), two rows with no number or street, and one line
    // that is not a feature leave nine addresses.
    assert_eq!(south.len(), 9);
    assert_eq!(rows[&Partition::West].len(), 15 + 2);
    assert_eq!(rows[&Partition::Northeast].len(), 2);
    assert!(rows[&Partition::Midwest].is_empty());
}

#[test]
fn a_short_prefix_finds_the_address_through_a_split() {
    let opened = open_all(false);
    assert_eq!(opened.engine.document_count(), 9 + 17 + 2);
    let offers = opened
        .engine
        .suggest("1402 lawson cr", 8, Some("NC"))
        .unwrap();
    let found = labels(&offers);
    assert_eq!(found[0], "1402 LAWSON CREEK WAY, WAKE FOREST, NC 27587");
    assert!(found.contains(&"1402 LAWSON CREEK WAY, LAS VEGAS, NV 89123".to_owned()));
    assert!(
        !found.iter().any(|label| label.contains("RIDGE")),
        "a completed word must match exactly: {found:?}"
    );
    match &offers[0] {
        Offer::Address { address, .. } => {
            assert_eq!(address.street, "LAWSON CREEK WAY");
            assert_eq!(address.unit, "");
            assert_eq!(address.postcode, "27587");
            assert!((address.longitude - -78.5101).abs() < 1e-9);
            assert!((address.latitude - 35.9701).abs() < 1e-9);
        }
        Offer::Group { .. } => panic!("a single building is an address"),
    }
}

#[test]
fn nothing_is_asked_without_a_number_and_a_second_word() {
    let opened = open_all(false);
    assert!(opened.engine.suggest("1402", 8, None).unwrap().is_empty());
    assert!(opened
        .engine
        .suggest("lawson creek", 8, None)
        .unwrap()
        .is_empty());
    assert!(opened.engine.suggest("", 8, None).unwrap().is_empty());
}

#[test]
fn the_near_region_reorders_but_never_filters() {
    let opened = open_all(false);
    let near_nevada = labels(
        &opened
            .engine
            .suggest("1402 lawson creek", 8, Some("NV"))
            .unwrap(),
    );
    let near_carolina = labels(
        &opened
            .engine
            .suggest("1402 lawson creek", 8, Some("nc"))
            .unwrap(),
    );
    let nowhere = labels(&opened.engine.suggest("1402 lawson creek", 8, None).unwrap());
    assert!(near_nevada[0].ends_with("NV 89123"), "{near_nevada:?}");
    assert!(near_carolina[0].ends_with("NC 27587"), "{near_carolina:?}");
    for answer in [&near_nevada, &near_carolina, &nowhere] {
        assert_eq!(
            answer.len(),
            2,
            "both states are offered every time: {answer:?}"
        );
    }
    // A region with no match at all filters nothing either.
    let near_texas = labels(
        &opened
            .engine
            .suggest("1402 lawson creek", 8, Some("TX"))
            .unwrap(),
    );
    assert_eq!(near_texas.len(), 2);
}

#[test]
fn the_limit_is_honoured_and_clamped() {
    let opened = open_all(false);
    assert_eq!(opened.engine.suggest("1402 la", 1, None).unwrap().len(), 1);
    assert_eq!(opened.engine.suggest("1402 la", 0, None).unwrap().len(), 1);
    let all = opened.engine.suggest("1402 la", 100, None).unwrap();
    assert!(all.len() <= 10);
    assert_eq!(all.len(), 6, "{:?}", labels(&all));
}

#[test]
fn units_of_one_building_collapse_into_a_group_with_an_exact_count() {
    let opened = open_all(false);
    let offers = opened.engine.suggest("1042 w cen", 8, Some("UT")).unwrap();
    let group = offers
        .iter()
        .find_map(|offer| match offer {
            Offer::Group {
                label,
                count,
                building,
            } => Some((label.clone(), *count, building.clone())),
            Offer::Address { .. } => None,
        })
        .expect("a group");
    assert_eq!(group.0, "1042 W CENTER ST, OREM, UT 84057");
    // The building's own row and thirteen units, counted over the index, not over the hits.
    assert_eq!(group.1, 14);
    assert_eq!(group.2.city, "OREM");
    // The other building on the same street name, in another city, stays a plain address.
    assert!(labels(&offers).contains(&"1042 W CENTER ST, PROVO, UT 84601".to_owned()));
    assert_eq!(offers.len(), 2, "{:?}", labels(&offers));

    // Even with only one row of the building among the hits, the count is the whole building.
    let one = opened
        .engine
        .suggest("1042 w center st 12", 1, None)
        .unwrap();
    match &one[0] {
        Offer::Group { count, .. } => assert_eq!(*count, 14),
        Offer::Address { label, .. } => panic!("expected the building, got {label}"),
    }
}

#[test]
fn units_open_in_natural_order() {
    let opened = open_all(false);
    let building = Building {
        number: "1042".to_owned(),
        street: "w center st".to_owned(),
        city: "Orem".to_owned(),
        region: "ut".to_owned(),
        postcode: "84057".to_owned(),
    };
    let units: Vec<String> = opened
        .engine
        .units(&building)
        .unwrap()
        .into_iter()
        .map(|address| address.unit)
        .collect();
    assert_eq!(
        units,
        vec!["", "1", "2", "2A", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]
    );
    let missing = Building {
        number: "9999".to_owned(),
        ..building.clone()
    };
    assert!(opened.engine.units(&missing).unwrap().is_empty());
    let incomplete = Building {
        street: String::new(),
        ..building
    };
    assert!(opened.engine.units(&incomplete).unwrap().is_empty());
}

#[test]
fn a_whole_word_outranks_a_longer_word_with_the_same_start() {
    let opened = open_all(false);
    let found = labels(&opened.engine.suggest("100 main", 8, None).unwrap());
    assert_eq!(found[0], "100 MAIN ST, WAKE FOREST, NC 27587", "{found:?}");
    assert!(found.contains(&"100 MAINSAIL DR, CARY, NC 27511".to_owned()));
}

#[test]
fn words_typed_in_full_match_their_usps_abbreviations() {
    let opened = open_all(false);
    let found = labels(&opened.engine.suggest("100 main street", 8, None).unwrap());
    assert!(
        found.contains(&"100 MAIN ST, WAKE FOREST, NC 27587".to_owned()),
        "{found:?}"
    );
    assert!(
        !found.iter().any(|label| label.contains("MAINSAIL")),
        "{found:?}"
    );
    let found = labels(&opened.engine.suggest("100 north main st", 8, None).unwrap());
    assert_eq!(found, vec!["100 N MAIN ST, FUQUAY-VARINA, NC 27526"]);
}

#[test]
fn a_pasted_full_address_finds_itself() {
    let opened = open_all(false);
    let found = labels(
        &opened
            .engine
            .suggest("1402 Lawson Creek Way, Wake Forest, NC 27587", 8, None)
            .unwrap(),
    );
    assert_eq!(found, vec!["1402 LAWSON CREEK WAY, WAKE FOREST, NC 27587"]);
}

#[test]
fn accents_hyphenated_numbers_and_missing_parts_read_cleanly() {
    let opened = open_all(false);
    let found = labels(&opened.engine.suggest("15 calle pena", 8, None).unwrap());
    assert_eq!(found, vec!["15 CALLE PEÑA, RALEIGH, NC 27601"]);
    let found = labels(&opened.engine.suggest("123-45 queens", 8, None).unwrap());
    assert_eq!(found, vec!["123-45 QUEENS BLVD, QUEENS, NY 11375"]);
    let found = labels(&opened.engine.suggest("613 mt el", 8, None).unwrap());
    assert_eq!(found, vec!["613 MT ELBERT WAY, NV"]);
    let found = labels(&opened.engine.suggest("7634 old us 1 h", 8, None).unwrap());
    assert_eq!(found, vec!["7634 OLD US 1 HWY, NEW HILL, NC"]);
}

#[test]
fn a_warm_repeated_keystroke_reads_little_or_nothing() {
    let opened = open_all(true);
    let opening = opened.take_reads();
    assert!(opening > 0);

    // The first keystroke after an open loads what the query walks.
    let first = opened
        .engine
        .suggest("1402 lawson cr", 8, Some("NC"))
        .unwrap();
    let cold = opened.take_reads();
    assert!(!first.is_empty());
    assert!(cold > 0);

    // The same keystroke again (a debounce re-send, a second form) is served from the cache.
    let again = opened
        .engine
        .suggest("1402 lawson cr", 8, Some("NC"))
        .unwrap();
    assert_eq!(labels(&again), labels(&first));
    assert_eq!(
        opened.take_reads(),
        0,
        "a repeated keystroke must cost no reads"
    );

    // The next keystroke reads only the postings of the one new prefix, per partition, and rows it
    // has not read before: a small, bounded number however large the partition.
    opened
        .engine
        .suggest("1402 lawson cre", 8, Some("NC"))
        .unwrap();
    let next = opened.take_reads();
    assert!(next <= 8, "the next keystroke read {next} times");
}

#[test]
fn a_split_that_is_not_an_address_partition_is_refused() {
    let foreign = search_core::build_split(&[search_core::IndexDocument {
        document_id: "d".to_owned(),
        chunk_id: "c".to_owned(),
        body: "text".to_owned(),
    }])
    .unwrap();
    let reader = CountingReader::new(foreign, false);
    assert!(PartitionIndex::open(Partition::South, reader).is_err());
    let truncated = CountingReader::new(vec![1, 2, 3], false);
    assert!(PartitionIndex::open(Partition::South, truncated).is_err());
}
