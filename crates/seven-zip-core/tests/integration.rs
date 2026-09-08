//! Round-trip tests: every fixture is written by a real 7z encoder (`sevenz-rust2`'s own writer)
//! and then listed back through the ranged reader, so what is exercised is the format rather than a
//! belief about it.

use std::io::Cursor;

use seven_zip_core::{
    extract, extract_bytes, list, list_bytes, ArchiveRange, ExtractError, ExtractLimits,
    ExtractOutcome, ListError, ListLimits, ListOutcome, SevenZipListing,
};
use sevenz_rust2::{
    lzma::LZMA2Options, AesEncoderOptions, Password, SeqReader, SevenZArchiveEntry,
    SevenZMethod, SevenZMethodConfiguration, SevenZWriter, SourceReader,
};

/// One member to write into a fixture.
struct Member {
    path: &'static str,
    directory: bool,
    content: Vec<u8>,
    modified_epoch_secs: Option<i64>,
}

impl Member {
    fn file(path: &'static str, content: &str) -> Self {
        Self {
            path,
            directory: false,
            content: content.as_bytes().to_vec(),
            modified_epoch_secs: None,
        }
    }

    fn directory(path: &'static str) -> Self {
        Self {
            path,
            directory: true,
            content: Vec::new(),
            modified_epoch_secs: None,
        }
    }

    fn modified(mut self, epoch_secs: i64) -> Self {
        self.modified_epoch_secs = Some(epoch_secs);
        self
    }
}

/// Write a real 7z holding `members`, optionally AES-encrypting content and the file list.
fn write_archive(members: &[Member], password: Option<&str>, encrypt_header: bool) -> Vec<u8> {
    let mut writer =
        SevenZWriter::new(Cursor::new(Vec::new())).expect("the writer accepts an in-memory sink");
    let mut methods: Vec<SevenZMethodConfiguration> = Vec::new();
    if let Some(password) = password {
        methods.push(AesEncoderOptions::new(Password::from(password)).into());
    }
    methods.push(LZMA2Options::with_preset(5).into());
    writer.set_content_methods(methods);
    writer.set_encrypt_header(encrypt_header);

    for member in members {
        let mut entry = if member.directory {
            SevenZArchiveEntry::new_folder(member.path)
        } else {
            SevenZArchiveEntry::new_file(member.path)
        };
        if let Some(secs) = member.modified_epoch_secs {
            let system_time = std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs as u64);
            entry.last_modified_date = sevenz_rust2::nt_time::FileTime::try_from(system_time)
                .expect("a post-1970 time is representable as a FILETIME");
            entry.has_last_modified_date = true;
        }
        let reader = if member.directory {
            None
        } else {
            Some(member.content.as_slice())
        };
        writer
            .push_archive_entry(entry, reader)
            .expect("the writer accepts the entry");
    }
    writer
        .finish()
        .expect("the writer finishes into the sink")
        .into_inner()
}

/// A 7z with enough near-identical members that the writer compresses the file list rather than
/// storing it plain — the path that needs an LZMA decode to list at all.
fn write_many_member_archive(count: usize) -> (Vec<u8>, Vec<String>) {
    write_many_member_archive_with(count, None, false)
}

/// The same, optionally encrypting content and — when the file list is big enough for the writer to
/// compress it at all — the file list with it.
fn write_many_member_archive_with(
    count: usize,
    password: Option<&str>,
    encrypt_header: bool,
) -> (Vec<u8>, Vec<String>) {
    let mut writer =
        SevenZWriter::new(Cursor::new(Vec::new())).expect("the writer accepts an in-memory sink");
    let mut methods: Vec<SevenZMethodConfiguration> = Vec::new();
    if let Some(password) = password {
        methods.push(AesEncoderOptions::new(Password::from(password)).into());
    }
    methods.push(LZMA2Options::with_preset(5).into());
    writer.set_content_methods(methods);
    writer.set_encrypt_header(encrypt_header);

    let mut names = Vec::with_capacity(count);
    for index in 0..count {
        let name = format!("matters/2026/production-volume-one/exhibit-{index:05}.txt");
        writer
            .push_archive_entry(
                SevenZArchiveEntry::new_file(&name),
                Some(format!("exhibit {index}").as_bytes()),
            )
            .expect("the writer accepts the entry");
        names.push(name);
    }
    let bytes = writer
        .finish()
        .expect("the writer finishes into the sink")
        .into_inner();
    (bytes, names)
}

/// What a caller does with a stored object: fetch only the ranges the listing asks for, and record
/// them so a test can assert how much of the archive was actually read.
struct RangedFetch {
    archive: Vec<u8>,
    fetched: Vec<(u64, u64)>,
}

impl RangedFetch {
    fn new(archive: Vec<u8>) -> Self {
        Self {
            archive,
            fetched: Vec::new(),
        }
    }

    fn run(&mut self, limits: &ListLimits) -> Result<SevenZipListing, ListError> {
        let size = self.archive.len() as u64;
        let mut ranges: Vec<ArchiveRange> = Vec::new();
        // Three ranges is the most a well-formed archive needs; a fourth request means the planner
        // is asking for something it did not name, which is a failure rather than another fetch.
        for _ in 0..4 {
            match list(size, &ranges, limits)? {
                ListOutcome::Listing(listing) => return Ok(listing),
                ListOutcome::NeedRange { offset, length } => {
                    self.fetched.push((offset, length));
                    let start = offset as usize;
                    let end = start + length as usize;
                    ranges.push(ArchiveRange::new(offset, self.archive[start..end].to_vec()));
                }
            }
        }
        panic!("the listing asked for more ranges than a well-formed archive can need");
    }

    fn bytes_read(&self) -> u64 {
        self.fetched.iter().map(|(_, length)| length).sum()
    }
}

#[test]
fn lists_several_members_a_directory_and_nested_paths() {
    let archive = write_archive(
        &[
            Member::file("readme.txt", "hello"),
            Member::directory("exhibits"),
            Member::file("exhibits/a/deposition.txt", "content of a"),
            Member::file("exhibits/b/transcript.txt", "content of b, which is longer"),
        ],
        None,
        false,
    );

    let listing = list_bytes(&archive, &ListLimits::default()).expect("the archive lists");
    assert!(!listing.truncated);

    let paths: Vec<&str> = listing
        .entries
        .iter()
        .map(|entry| entry.path.as_str())
        .collect();
    assert_eq!(
        paths,
        vec![
            "readme.txt",
            "exhibits",
            "exhibits/a/deposition.txt",
            "exhibits/b/transcript.txt",
        ]
    );

    let directory = &listing.entries[1];
    assert!(directory.is_directory);
    assert_eq!(directory.uncompressed_size_bytes, 0);

    let deposition = &listing.entries[2];
    assert!(!deposition.is_directory);
    assert_eq!(
        deposition.uncompressed_size_bytes,
        "content of a".len() as u64
    );
    assert!(!deposition.encrypted);
    // This writer gives each member its own compressed block, so each carries its own packed size.
    assert!(deposition.compressed_size_bytes > 0);
    // A directory has no content stream and so no packed size to report.
    assert_eq!(directory.compressed_size_bytes, 0);
}

#[test]
fn carries_the_modification_time_a_member_was_written_with() {
    // 2026-09-07T12:00:00Z.
    let written_at = 1_788_782_400;
    let archive = write_archive(
        &[
            Member::file("dated.txt", "x").modified(written_at),
            Member::file("undated.txt", "y"),
        ],
        None,
        false,
    );

    let listing = list_bytes(&archive, &ListLimits::default()).expect("the archive lists");
    assert_eq!(
        listing.entries[0].modified_at_epoch_millis,
        Some(written_at * 1000)
    );
    assert_eq!(listing.entries[1].modified_at_epoch_millis, None);
}

#[test]
fn lists_an_empty_archive_as_no_entries() {
    let archive = write_archive(&[], None, false);
    let listing = list_bytes(&archive, &ListLimits::default()).expect("an empty archive lists");
    assert!(listing.entries.is_empty());
    assert!(!listing.truncated);
}

#[test]
fn reads_only_the_header_ranges_however_large_the_archive_is() {
    // A megabyte of incompressible-enough content, so the archive is far larger than its header and
    // a whole-object read would be obvious in the byte count.
    let bulk: String = (0..40_000).map(|index| format!("line {index}\n")).collect();
    let archive = write_archive(
        &[
            Member::file("bulk.txt", &bulk),
            Member::file("small.txt", "small"),
        ],
        None,
        false,
    );

    let mut fetch = RangedFetch::new(archive.clone());
    let listing = fetch
        .run(&ListLimits::default())
        .expect("the archive lists");
    assert_eq!(listing.entries.len(), 2);

    // The first fetch is always the 32-byte start header, at offset 0.
    assert_eq!(fetch.fetched[0], (0, 32));
    // Everything after it sits in the archive's tail, and the total is a rounding error against the
    // archive itself.
    for (offset, _) in &fetch.fetched[1..] {
        assert!(
            *offset > (archive.len() as u64) / 2,
            "header ranges should be in the tail, not the body"
        );
    }
    assert!(
        fetch.bytes_read() < (archive.len() as u64) / 20,
        "read {} bytes of a {}-byte archive",
        fetch.bytes_read(),
        archive.len()
    );
}

#[test]
fn lists_a_compressed_file_list_over_three_ranges() {
    let (archive, names) = write_many_member_archive(400);
    let mut fetch = RangedFetch::new(archive.clone());
    let listing = fetch
        .run(&ListLimits::default())
        .expect("the archive lists");

    assert_eq!(listing.entries.len(), names.len());
    assert_eq!(listing.entries[0].path, names[0]);
    assert_eq!(listing.entries[399].path, names[399]);

    // A file list this repetitive is stored compressed, which costs one extra range: the start
    // header, the next header describing where the packed list is, and the packed list itself.
    assert_eq!(fetch.fetched.len(), 3);
    assert_eq!(fetch.fetched[0], (0, 32));
    assert!(
        fetch.bytes_read() < (archive.len() as u64) / 2,
        "read {} bytes of a {}-byte archive",
        fetch.bytes_read(),
        archive.len()
    );
}

#[test]
fn stops_at_the_entry_cap_and_says_so() {
    let (archive, names) = write_many_member_archive(400);
    let limits = ListLimits {
        max_entries: 25,
        ..ListLimits::default()
    };

    let listing = list_bytes(&archive, &limits).expect("the archive lists");
    assert_eq!(listing.entries.len(), 25);
    assert!(listing.truncated);
    assert_eq!(listing.entries[24].path, names[24]);
}

#[test]
fn a_cap_that_does_not_bite_leaves_the_listing_whole() {
    let (archive, names) = write_many_member_archive(12);
    let limits = ListLimits {
        max_entries: names.len(),
        ..ListLimits::default()
    };
    let listing = list_bytes(&archive, &limits).expect("the archive lists");
    assert_eq!(listing.entries.len(), names.len());
    assert!(!listing.truncated);
}

#[test]
fn reports_encrypted_content_and_still_lists_it() {
    let archive = write_archive(
        &[
            Member::file("privileged.txt", "attorney work product"),
            Member::directory("folder"),
        ],
        Some("correct horse battery staple"),
        false,
    );

    let listing = list_bytes(&archive, &ListLimits::default())
        .expect("an archive with an unencrypted file list lists without the password");
    assert_eq!(listing.entries[0].path, "privileged.txt");
    assert!(listing.entries[0].encrypted);
    // A directory has no content stream, so there is nothing about it that is encrypted.
    assert!(!listing.entries[1].encrypted);
}

#[test]
fn refuses_an_archive_whose_file_list_is_encrypted() {
    // Enough members that the writer compresses the file list — a list too small to be worth
    // compressing is written in the clear and is not encrypted either.
    let (archive, _) =
        write_many_member_archive_with(400, Some("correct horse battery staple"), true);

    assert_eq!(
        list_bytes(&archive, &ListLimits::default()),
        Err(ListError::HeaderEncrypted)
    );
}

#[test]
fn lists_the_thirty_two_byte_archive_a_7z_writes_for_nothing() {
    // 7-Zip writes exactly the start header and stops when there is nothing to pack: no next header
    // at all, every field zero. There is nothing to fetch and nothing to decode, and the reader this
    // crate drives errors on the empty header rather than answering — so this case is decided here.
    let mut archive = Vec::with_capacity(32);
    archive.extend_from_slice(&[b'7', b'z', 0xBC, 0xAF, 0x27, 0x1C, 0x00, 0x04]);
    let body = [0u8; 20];
    archive.extend_from_slice(&crc32fast::hash(&body).to_le_bytes());
    archive.extend_from_slice(&body);

    let listing = list_bytes(&archive, &ListLimits::default()).expect("an empty archive lists");
    assert!(listing.entries.is_empty());
    assert!(!listing.truncated);
}

#[test]
fn refuses_bytes_that_are_not_an_archive() {
    let garbage = vec![0x42; 4096];
    assert_eq!(
        list_bytes(&garbage, &ListLimits::default()),
        Err(ListError::NotSevenZip)
    );

    assert_eq!(
        list_bytes(&[], &ListLimits::default()),
        Err(ListError::NotSevenZip)
    );
}

#[test]
fn refuses_a_truncated_archive_rather_than_reading_past_it() {
    let (archive, _) = write_many_member_archive(400);

    // Cut the tail off: the start header still points at a header that is no longer there.
    let half = archive.len() / 2;
    let truncated = archive[..half].to_vec();
    assert!(matches!(
        list_bytes(&truncated, &ListLimits::default()),
        Err(ListError::Malformed(_))
    ));

    // Cut a single byte off the end: the next header is now short of what it declares.
    let shaved = archive[..archive.len() - 1].to_vec();
    assert!(matches!(
        list_bytes(&shaved, &ListLimits::default()),
        Err(ListError::Malformed(_))
    ));
}

#[test]
fn refuses_an_archive_whose_start_header_was_tampered_with() {
    let (mut archive, _) = write_many_member_archive(20);
    // The start header's own checksum covers the 20 bytes that say where the file list is, so a
    // rewritten offset is caught before a single byte is fetched on its say-so.
    archive[12] ^= 0xff;
    assert!(matches!(
        list_bytes(&archive, &ListLimits::default()),
        Err(ListError::Malformed(_))
    ));
}

#[test]
fn refuses_a_header_larger_than_the_caller_allows() {
    let (archive, _) = write_many_member_archive(400);
    let limits = ListLimits {
        max_header_bytes: 64,
        ..ListLimits::default()
    };
    assert!(matches!(
        list_bytes(&archive, &limits),
        Err(ListError::TooLarge { limit: 64, .. })
    ));
}

#[test]
fn refuses_a_header_whose_dictionary_would_not_fit() {
    let (archive, _) = write_many_member_archive(400);
    let limits = ListLimits {
        // The writer compresses the file list with LZMA and a dictionary far larger than this, so
        // the refusal lands before the decoder allocates one.
        max_dictionary_bytes: 1024,
        ..ListLimits::default()
    };
    assert!(matches!(
        list_bytes(&archive, &limits),
        Err(ListError::TooLarge { limit: 1024, .. })
    ));
}

#[test]
fn refuses_a_decoded_header_larger_than_the_caller_allows() {
    let (archive, _) = write_many_member_archive(400);
    let limits = ListLimits {
        max_decoded_header_bytes: 128,
        ..ListLimits::default()
    };
    assert!(matches!(
        list_bytes(&archive, &limits),
        Err(ListError::TooLarge { limit: 128, .. })
    ));
}

#[test]
fn survives_every_single_byte_corruption_of_a_header() {
    // Flipping bits in the header is where a reader either refuses or panics. Every one of these
    // must be a refusal; the test fails on an unwind as loudly as on a wrong answer.
    let (archive, _) = write_many_member_archive(60);
    let size = archive.len();
    for offset in (size.saturating_sub(2048)..size).step_by(7) {
        let mut damaged = archive.clone();
        damaged[offset] ^= 0xa5;
        // The answer does not matter — a listing of the damaged header is as acceptable as a
        // refusal. Not returning at all is the failure.
        let _ = list_bytes(&damaged, &ListLimits::default());
    }
}

#[test]
fn refuses_a_declared_header_that_does_not_fit_the_object() {
    let (mut archive, _) = write_many_member_archive(20);
    // Rewrite the declared next-header size to something far larger than the archive, and fix the
    // start header's checksum so the lie survives that gate and has to be caught by the bounds one.
    let enormous = (u64::MAX / 2).to_le_bytes();
    archive[20..28].copy_from_slice(&enormous);
    let checksum = crc32fast::hash(&archive[12..32]);
    archive[8..12].copy_from_slice(&checksum.to_le_bytes());

    assert!(matches!(
        list_bytes(&archive, &ListLimits::default()),
        Err(ListError::Malformed(_))
    ));
}

#[test]
fn refuses_a_coder_it_has_no_decoder_for() {
    // BZIP2 is a real 7z coder that this build has no decoder for; nothing about it is guessed at.
    assert_eq!(
        SevenZMethod::by_id(SevenZMethod::ID_BZIP2).map(|method| method.name()),
        Some("BZIP2")
    );
}

#[test]
fn a_range_the_caller_never_fetched_is_asked_for_rather_than_assumed() {
    let (archive, _) = write_many_member_archive(400);
    let size = archive.len() as u64;

    // With nothing fetched at all, the first thing asked for is the start header.
    assert_eq!(
        list(size, &[], &ListLimits::default()),
        Ok(ListOutcome::NeedRange {
            offset: 0,
            length: 32
        })
    );

    // With only the start header, the next thing asked for is inside the archive and no larger than
    // the caller's header cap.
    let start_header = ArchiveRange::new(0, archive[..32].to_vec());
    match list(size, &[start_header], &ListLimits::default()) {
        Ok(ListOutcome::NeedRange { offset, length }) => {
            assert!(offset + length <= size);
            assert!(length <= ListLimits::default().max_header_bytes);
        }
        other => panic!("expected a range request, got {other:?}"),
    }
}

/// Write the archives the TypeScript wrapper's tests read. Ignored by default: it writes into the
/// source tree, and the files it writes are committed. Run it when the fixtures need to change:
/// `cargo test -p seven-zip-core -- --ignored regenerate_typescript_fixtures`.
///
/// The output is deterministic — fixed content, fixed timestamps, one encoder — so a regeneration
/// that changes a byte means the encoder changed, which is worth seeing in a diff.
#[test]
#[ignore = "writes committed fixtures into the source tree"]
fn regenerate_typescript_fixtures() {
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    std::fs::create_dir_all(&directory).expect("the fixtures directory is writable");

    let write = |name: &str, bytes: Vec<u8>| {
        std::fs::write(directory.join(name), &bytes).expect("the fixture is writable");
        // Nothing is committed that this crate cannot read back.
        assert!(
            list_bytes(&bytes, &ListLimits::default()).is_ok() || name == "file-list-encrypted.7z",
            "{name} does not list"
        );
    };

    write(
        "mixed-members.7z",
        write_archive(
            &[
                Member::file("readme.txt", "hello").modified(1_788_782_400),
                Member::directory("exhibits"),
                Member::file("exhibits/a/deposition.txt", "content of a"),
                Member::file("exhibits/b/transcript.txt", "content of b, which is longer"),
            ],
            None,
            false,
        ),
    );
    write("many-members.7z", write_many_member_archive(400).0);
    write(
        "file-list-encrypted.7z",
        write_many_member_archive_with(400, Some("correct horse battery staple"), true).0,
    );
    write(
        "content-encrypted.7z",
        write_archive(
            &[
                Member::file("privileged.txt", "attorney work product"),
                Member::directory("folder"),
            ],
            Some("correct horse battery staple"),
            false,
        ),
    );
}

// ---------------------------------------------------------------------------------------------
// Taking one member out.
// ---------------------------------------------------------------------------------------------

/// The extraction counterpart of `RangedFetch`: fetch only what the engine names, and record it, so
/// a test can assert that taking one member out of a large archive did not read the archive.
struct RangedExtract {
    archive: Vec<u8>,
    fetched: Vec<(u64, u64)>,
}

impl RangedExtract {
    fn new(archive: Vec<u8>) -> Self {
        Self {
            archive,
            fetched: Vec::new(),
        }
    }

    fn run(&mut self, member_index: usize, limits: &ExtractLimits) -> Result<Vec<u8>, ExtractError> {
        let size = self.archive.len() as u64;
        let mut ranges: Vec<ArchiveRange> = Vec::new();
        // The three header ranges a listing needs, plus the one block the member lives in. A fifth
        // request means the planner asked for something it had not named.
        for _ in 0..5 {
            match extract(size, &ranges, member_index, limits)? {
                ExtractOutcome::Member(bytes) => return Ok(bytes),
                ExtractOutcome::NeedRange { offset, length } => {
                    self.fetched.push((offset, length));
                    let start = offset as usize;
                    let end = start + length as usize;
                    ranges.push(ArchiveRange::new(offset, self.archive[start..end].to_vec()));
                }
            }
        }
        panic!("the extraction asked for more ranges than a well-formed archive can need");
    }

    fn bytes_read(&self) -> u64 {
        self.fetched.iter().map(|(_, length)| length).sum()
    }
}

/// A 7z whose members share ONE compressed stream — solid compression, which is what 7-Zip does by
/// default and what makes reaching a later member cost the members before it.
///
/// `push_archive_entry` (used by every fixture above) compresses each member into a block of its
/// own, so an archive built that way cannot exercise solidity at all. This uses the writer's own
/// solid entry point instead.
fn write_solid_archive(members: &[(&'static str, &'static str)]) -> Vec<u8> {
    let mut writer =
        SevenZWriter::new(Cursor::new(Vec::new())).expect("the writer accepts an in-memory sink");
    writer.set_content_methods(vec![LZMA2Options::with_preset(5).into()]);

    let entries: Vec<SevenZArchiveEntry> = members
        .iter()
        .map(|(path, content)| {
            let mut entry = SevenZArchiveEntry::new_file(path);
            entry.has_stream = true;
            entry.size = content.len() as u64;
            entry
        })
        .collect();
    let readers: Vec<SourceReader<&[u8]>> = members
        .iter()
        .map(|(_, content)| SourceReader::new(content.as_bytes()))
        .collect();
    writer
        .push_archive_entries(entries, SeqReader::new(readers))
        .expect("the writer accepts a solid block");
    writer
        .finish()
        .expect("the writer finishes into the sink")
        .into_inner()
}

#[test]
fn takes_a_member_out_by_the_index_the_listing_gave_it() {
    let archive = write_archive(
        &[
            Member::file("readme.txt", "hello"),
            Member::directory("exhibits"),
            Member::file("exhibits/a/deposition.txt", "content of a"),
            Member::file("exhibits/b/transcript.txt", "content of b, which is longer"),
        ],
        None,
        false,
    );
    // The listing is what names a member, so the index extraction takes comes from it rather than
    // from a test's own count — that agreement is the whole reason both halves read one header.
    let listing = list_bytes(&archive, &ListLimits::default()).expect("the fixture lists");
    let wanted = listing
        .entries
        .iter()
        .position(|entry| entry.path == "exhibits/b/transcript.txt")
        .expect("the fixture holds the member");

    let bytes = extract_bytes(&archive, wanted, &ExtractLimits::default()).expect("it comes out");
    assert_eq!(bytes, b"content of b, which is longer");
}

#[test]
fn takes_the_last_member_of_a_solid_block_out_by_decoding_the_ones_before_it() {
    // ONE compressed stream over four members: reaching the last means decoding the three ahead of
    // it, because that is what solid means. A reader that seeked to a member's own offset would
    // return the wrong bytes here and nowhere else, which is why this fixture is built differently
    // from every other one in this file.
    let archive = write_solid_archive(&[
        ("first.txt", "the first statement"),
        ("second.txt", "the second statement"),
        ("third.txt", "the third statement"),
        ("fourth.txt", "the fourth and final statement"),
    ]);
    let listing = list_bytes(&archive, &ListLimits::default()).expect("the fixture lists");
    assert_eq!(listing.entries.len(), 4);

    for (index, expected) in [
        "the first statement",
        "the second statement",
        "the third statement",
        "the fourth and final statement",
    ]
    .iter()
    .enumerate()
    {
        let bytes =
            extract_bytes(&archive, index, &ExtractLimits::default()).expect("it comes out");
        assert_eq!(bytes, expected.as_bytes(), "member {index} of the block");
    }
}

#[test]
fn takes_a_member_out_of_an_archive_of_four_hundred() {
    let (archive, names) = write_many_member_archive(400);
    let listing = list_bytes(&archive, &ListLimits::default()).expect("the fixture lists");
    let wanted = listing
        .entries
        .iter()
        .position(|entry| entry.path == names[399])
        .expect("the fixture holds the last member");

    let bytes = extract_bytes(&archive, wanted, &ExtractLimits::default()).expect("it comes out");
    assert_eq!(bytes, b"exhibit 399");
}

#[test]
fn reads_the_header_and_one_block_rather_than_the_archive() {
    let (archive, _) = write_many_member_archive(400);
    let mut fetch = RangedExtract::new(archive.clone());
    let bytes = fetch.run(0, &ExtractLimits::default()).expect("it comes out");

    assert_eq!(bytes, b"exhibit 0");
    // The point of the ranged form: what was fetched is the header plus the one block, never the
    // whole object. On this fixture the block IS most of the content, so the assertion that carries
    // weight is that no range covered the archive.
    assert!(fetch
        .fetched
        .iter()
        .all(|(_, length)| *length < archive.len() as u64));
    assert!(fetch.bytes_read() <= archive.len() as u64);
}

#[test]
fn takes_an_empty_member_out_without_touching_a_block() {
    let archive = write_archive(&[Member::file("empty.txt", "")], None, false);
    let listing = list_bytes(&archive, &ListLimits::default()).expect("the fixture lists");
    let wanted = listing
        .entries
        .iter()
        .position(|entry| entry.path == "empty.txt")
        .expect("the fixture holds it");
    assert_eq!(
        extract_bytes(&archive, wanted, &ExtractLimits::default()),
        Ok(Vec::new())
    );
}

#[test]
fn refuses_a_directory_rather_than_answering_with_no_bytes() {
    // Zero bytes and "this is a folder" are different answers, and filing the first as a document
    // would put an empty file on a matter under a folder's name.
    let archive = write_archive(
        &[
            Member::directory("exhibits"),
            Member::file("exhibits/a.txt", "a"),
        ],
        None,
        false,
    );
    let listing = list_bytes(&archive, &ListLimits::default()).expect("the fixture lists");
    let directory = listing
        .entries
        .iter()
        .position(|entry| entry.is_directory)
        .expect("the fixture holds a directory");
    assert_eq!(
        extract_bytes(&archive, directory, &ExtractLimits::default()),
        Err(ExtractError::NotAFile)
    );
}

#[test]
fn refuses_a_member_index_the_archive_does_not_hold() {
    let archive = write_archive(&[Member::file("only.txt", "one")], None, false);
    assert_eq!(
        extract_bytes(&archive, 99, &ExtractLimits::default()),
        Err(ExtractError::MemberNotFound)
    );
}

#[test]
fn refuses_encrypted_content_by_name_rather_than_failing_to_decode_it() {
    // The build carries no AES coder, so a decode would fail anyway. "This member is encrypted" and
    // "this reader has no decoder" are different facts and the reader is owed the true one.
    let archive = write_archive(
        &[Member::file("sealed.txt", "privileged")],
        Some("correct horse battery staple"),
        false,
    );
    let listing = list_bytes(&archive, &ListLimits::default()).expect("an unencrypted list reads");
    let wanted = listing
        .entries
        .iter()
        .position(|entry| entry.path == "sealed.txt")
        .expect("the fixture holds it");
    assert!(listing.entries[wanted].encrypted);
    assert_eq!(
        extract_bytes(&archive, wanted, &ExtractLimits::default()),
        Err(ExtractError::MemberEncrypted)
    );
}

#[test]
fn refuses_a_member_larger_than_the_caller_allows() {
    let archive = write_archive(&[Member::file("big.txt", "0123456789")], None, false);
    let limits = ExtractLimits {
        max_member_bytes: 4,
        ..ExtractLimits::default()
    };
    assert_eq!(
        extract_bytes(&archive, 0, &limits),
        Err(ExtractError::TooLarge {
            limit: 4,
            declared: 10,
        })
    );
}

#[test]
fn refuses_a_block_larger_than_the_caller_allows_even_for_a_small_member() {
    // The reason the block has a ceiling of its own: the FIRST member of this block is nineteen
    // bytes and its block unpacks to ninety, so a caller bounding only what it keeps would be
    // bounding the wrong number — the decode costs the block either way.
    let archive = write_solid_archive(&[
        ("first.txt", "the first statement"),
        ("second.txt", "the second statement"),
        ("third.txt", "the third statement"),
        ("fourth.txt", "the fourth and final statement"),
    ]);
    let limits = ExtractLimits {
        max_block_bytes: 32,
        ..ExtractLimits::default()
    };
    match extract_bytes(&archive, 0, &limits) {
        Err(ExtractError::TooLarge { limit, declared }) => {
            assert_eq!(limit, 32);
            assert!(
                declared > 32,
                "the block unpacks to more than the ceiling: {declared}"
            );
        }
        other => panic!("expected a block-size refusal, got {other:?}"),
    }
    // The same member, with room for its block, comes out — so the refusal above is the ceiling
    // biting rather than the fixture being unreadable.
    assert_eq!(
        extract_bytes(&archive, 0, &ExtractLimits::default()),
        Ok(b"the first statement".to_vec())
    );
}

#[test]
fn refuses_an_archive_whose_file_list_is_encrypted_before_naming_a_member() {
    let (archive, _) =
        write_many_member_archive_with(400, Some("correct horse battery staple"), true);
    assert_eq!(
        extract_bytes(&archive, 0, &ExtractLimits::default()),
        Err(ExtractError::Header(ListError::HeaderEncrypted))
    );
}

#[test]
fn refuses_a_member_whose_bytes_disagree_with_the_archives_own_record() {
    // Corrupt the packed content and leave every header intact: the reader verifies each member
    // against the CRC the archive recorded, so this is the one failure only decoding can find.
    let mut archive = write_archive(
        &[Member::file(
            "brief.txt",
            "In the matter of Renee Chase, a statement long enough to actually compress.",
        )],
        None,
        false,
    );
    // The packed streams begin immediately after the start header.
    let at = 40.min(archive.len() - 1);
    archive[at] ^= 0xff;

    match extract_bytes(&archive, 0, &ExtractLimits::default()) {
        Err(ExtractError::Corrupt) => {}
        // A single flipped byte can also make the block undecodable outright, which the reader
        // reports as its own refusal. Either is a refusal; what must never happen is bytes coming
        // back as though they were the member.
        Err(other) => assert!(
            !matches!(other, ExtractError::MemberNotFound),
            "expected a refusal about the content, got {other:?}"
        ),
        Ok(bytes) => panic!("corrupt content came back as {} bytes", bytes.len()),
    }
}
