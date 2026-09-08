//! Listing a 7z archive — names, sizes, directory flag, timestamps, encrypted flag — without
//! extracting any member's content.
//!
//! # Why this is not a byte parser
//!
//! A 7z keeps its file list in a header at the END of the archive, and that header is itself
//! normally LZMA-compressed, so reading it needs a real LZMA decoder. `sevenz-rust2` is that
//! decoder and it already builds in this repository, so this crate drives its reader rather than
//! reimplementing the format. The only bytes decoded here are the header's own; member content is
//! never touched.
//!
//! # How much of the archive gets read
//!
//! Two ranges for an archive whose header is stored plain, three when it is compressed:
//!
//! 1. `[0, 32)` — the start header, which carries the offset and size of the next header.
//! 2. `[32 + next_header_offset, + next_header_size)` — the next header itself.
//! 3. For a compressed header only: the packed stream the next header points at, whose exact
//!    offset and length come out of step 2. Real encoders place it immediately before the next
//!    header, so in practice it is a tail read.
//!
//! Nothing else is fetched, whatever the archive weighs. The caller drives this: [`list`] takes the
//! ranges it has and answers either a listing or [`ListOutcome::NeedRange`] naming the next range
//! to fetch, so a Worker loops at most three times against ranged object reads.
//!
//! # Untrusted input
//!
//! Every number here comes from a file someone uploaded. `sevenz-rust2` reads a few of them
//! straight into an allocation (a dictionary buffer, a decoded-header buffer) and indexes one coder
//! property slice without a length check, so the sizes that drive those are validated HERE, before
//! its reader ever sees them — see [`ListLimits`] and `check_header_coder`. What remains outside
//! this crate's reach is documented on [`ListLimits::max_entries`].

use std::borrow::Cow;
use std::io::{Cursor, Read, Seek, SeekFrom};

use sevenz_rust2::{Archive, SevenZMethod};

#[cfg(target_arch = "wasm32")]
mod wasm;

/// The fixed-size structure every 7z opens with: signature, version, and the location of the header
/// that holds the file list.
const START_HEADER_BYTES: u64 = 32;
/// Where the start header's 20 CRC-covered bytes begin.
const START_HEADER_BODY_AT: usize = 12;
const SIGNATURE: [u8; 6] = [b'7', b'z', 0xBC, 0xAF, 0x27, 0x1C];

/// The next header holds the file list in the clear.
const PROPERTY_HEADER: u8 = 0x01;
/// The next header is a description of where the REAL header sits, packed and usually compressed.
const PROPERTY_ENCODED_HEADER: u8 = 0x17;
const PROPERTY_MAIN_STREAMS_INFO: u8 = 0x04;
const PROPERTY_END: u8 = 0x00;

/// One member of an archive, in the shape every archive reader on this platform answers with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SevenZipEntry {
    pub path: String,
    pub is_directory: bool,
    /// Packed bytes. A 7z compresses members together in blocks, so a block's packed size is
    /// attributed to the first member in it and every later member of the same block reports 0 —
    /// there is no honest per-member figure to give when the members share one compressed stream.
    pub compressed_size_bytes: u64,
    pub uncompressed_size_bytes: u64,
    /// Unix epoch milliseconds, or `None` when the archive records no modification time.
    pub modified_at_epoch_millis: Option<i64>,
    /// Whether this member's block is AES-encrypted. Listing still works: 7z encrypts member
    /// content and the file list separately, and an archive with an encrypted file list never
    /// reaches here — it is refused as [`ListError::HeaderEncrypted`].
    pub encrypted: bool,
}

/// A contents listing. `truncated` says the archive holds more members than were returned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SevenZipListing {
    pub entries: Vec<SevenZipEntry>,
    pub truncated: bool,
}

/// What [`list`] answers: either the listing, or the next byte range it needs to produce one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ListOutcome {
    Listing(SevenZipListing),
    /// Fetch `[offset, offset + length)` from the archive, add it to the ranges, and call again.
    NeedRange {
        offset: u64,
        length: u64,
    },
}

/// A byte range of the archive the caller has already fetched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveRange {
    pub offset: u64,
    pub bytes: Vec<u8>,
}

impl ArchiveRange {
    pub fn new(offset: u64, bytes: Vec<u8>) -> Self {
        Self { offset, bytes }
    }

    fn end(&self) -> u64 {
        self.offset.saturating_add(self.bytes.len() as u64)
    }

    fn covers(&self, offset: u64, length: u64) -> bool {
        offset >= self.offset && offset.saturating_add(length) <= self.end()
    }
}

/// The ceilings a listing refuses to work above. Every one of them bounds something an archive
/// DECLARES about itself, which is why the caller sets them rather than the format.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListLimits {
    /// How many entries to return. Hitting it produces `truncated: true` rather than a refusal —
    /// see the note below on what this cannot bound.
    ///
    /// A header declares its own file count, and the reader allocates a vector of that many entries
    /// before any of them are parsed. That count is not visible to this crate until after the
    /// allocation it drives, so a hostile header can still force one large allocation; the cap
    /// below on the decoded header keeps the rest of the walk bounded, and the failure mode is a
    /// thrown error, never a wrong listing. Closing it entirely needs a bound inside
    /// `sevenz-rust2`'s own `read_files_info`.
    pub max_entries: usize,
    /// Largest next-header blob, and largest packed header stream, this will fetch and hold.
    pub max_header_bytes: u64,
    /// Largest decoded header. A compressed header declares its decompressed size, and the reader
    /// allocates that much before decoding into it.
    pub max_decoded_header_bytes: u64,
    /// Largest LZMA/LZMA2 dictionary a header decode may allocate. The dictionary size is a header
    /// property, not a function of the archive, and the decoder allocates it up front.
    pub max_dictionary_bytes: u64,
}

impl Default for ListLimits {
    fn default() -> Self {
        Self {
            max_entries: 10_000,
            // A file list for hundreds of thousands of members compresses to a few megabytes; a
            // header claiming more than this is not a list, it is a request for memory.
            max_header_bytes: 32 * 1024 * 1024,
            max_decoded_header_bytes: 256 * 1024 * 1024,
            // Comfortably above the 64 MiB an encoder would ever choose for a header, far below the
            // 4 GiB the format allows a property byte to ask for.
            max_dictionary_bytes: 256 * 1024 * 1024,
        }
    }
}

/// Why a listing could not be produced. Every variant is a refusal, never a panic: nothing derived
/// from archive bytes is unwrapped or indexed unchecked on the way here.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ListError {
    #[error("notSevenZip")]
    NotSevenZip,
    #[error("unsupportedVersion")]
    UnsupportedVersion,
    /// The file list is AES-encrypted. It can only be read with the password, which listing does
    /// not take.
    #[error("headerEncrypted")]
    HeaderEncrypted,
    /// The archive declares a header this reader will not allocate for. Carries the caller's cap
    /// and what was asked for, so the caller can decide whether to raise it.
    #[error("tooLarge")]
    TooLarge { limit: u64, declared: u64 },
    /// The header uses a coder this reader has no decoder for.
    #[error("unsupportedCoder")]
    UnsupportedCoder(Cow<'static, str>),
    /// The bytes do not describe an archive: a size that does not fit the object, a checksum that
    /// does not match, a header the reader could not walk.
    #[error("malformed")]
    Malformed(Cow<'static, str>),
    /// A range the caller supplied does not hold the bytes it claims to. A caller bug, not an
    /// archive one.
    #[error("rangeMismatch")]
    RangeMismatch,
}

fn malformed(reason: &'static str) -> ListError {
    ListError::Malformed(Cow::Borrowed(reason))
}

/// Where the file list lives, as the start header describes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NextHeaderLocation {
    /// Absolute offset in the archive — the start header stores it relative to its own end.
    pub offset: u64,
    pub size: u64,
    pub crc: u32,
}

/// Read the 32-byte start header. This is the one structure parsed here rather than by the reader,
/// because its whole job is to say which further bytes to fetch — the caller needs the answer
/// before it can hand over anything else.
pub fn read_start_header(
    start_header: &[u8],
    archive_size: u64,
    limits: &ListLimits,
) -> Result<NextHeaderLocation, ListError> {
    let header: [u8; 32] = start_header
        .get(..32)
        .and_then(|slice| slice.try_into().ok())
        .ok_or(ListError::RangeMismatch)?;

    if header[..6] != SIGNATURE {
        return Err(ListError::NotSevenZip);
    }
    // Major version 0 is every 7z ever written; a different one is a format this reader has not
    // seen and must not guess at.
    if header[6] != 0 {
        return Err(ListError::UnsupportedVersion);
    }

    let declared_crc = u32::from_le_bytes([header[8], header[9], header[10], header[11]]);
    let body = &header[START_HEADER_BODY_AT..];
    if crc32fast::hash(body) != declared_crc {
        // 7-Zip itself falls back to scanning the last megabyte for something header-shaped when
        // this fails. That is a repair tool's job, not a listing's: a scan reads a megabyte of a
        // file whose own index is already known to be wrong, and answers with a guess.
        return Err(malformed("start header checksum"));
    }

    let relative_offset = u64::from_le_bytes([
        body[0], body[1], body[2], body[3], body[4], body[5], body[6], body[7],
    ]);
    let size = u64::from_le_bytes([
        body[8], body[9], body[10], body[11], body[12], body[13], body[14], body[15],
    ]);
    let crc = u32::from_le_bytes([body[16], body[17], body[18], body[19]]);

    let offset = START_HEADER_BYTES
        .checked_add(relative_offset)
        .ok_or_else(|| malformed("next header offset overflows"))?;
    let end = offset
        .checked_add(size)
        .ok_or_else(|| malformed("next header size overflows"))?;
    if end > archive_size {
        return Err(malformed("next header runs past the end of the object"));
    }
    if size > limits.max_header_bytes {
        return Err(ListError::TooLarge {
            limit: limits.max_header_bytes,
            declared: size,
        });
    }

    Ok(NextHeaderLocation { offset, size, crc })
}

/// List an archive from the ranges fetched so far.
///
/// Returns [`ListOutcome::NeedRange`] until it holds every range it needs; fetch that range, append
/// it, and call again. Starting from no ranges at all, the sequence is at most: `[0, 32)`, the next
/// header, and — only for a compressed header — the packed stream it points at.
pub fn list(
    archive_size: u64,
    ranges: &[ArchiveRange],
    limits: &ListLimits,
) -> Result<ListOutcome, ListError> {
    if archive_size < START_HEADER_BYTES {
        return Err(ListError::NotSevenZip);
    }
    let Some(start_header) = slice_of(ranges, 0, START_HEADER_BYTES) else {
        return Ok(ListOutcome::NeedRange {
            offset: 0,
            length: START_HEADER_BYTES,
        });
    };
    let location = read_start_header(start_header, archive_size, limits)?;

    // An archive with no members writes no next header at all. There is nothing to fetch and
    // nothing to decode; the listing is empty because the archive is.
    if location.size == 0 {
        return Ok(ListOutcome::Listing(SevenZipListing {
            entries: Vec::new(),
            truncated: false,
        }));
    }

    let Some(next_header) = slice_of(ranges, location.offset, location.size) else {
        return Ok(ListOutcome::NeedRange {
            offset: location.offset,
            length: location.size,
        });
    };
    if crc32fast::hash(next_header) != location.crc {
        return Err(malformed("next header checksum"));
    }

    match next_header.first().copied() {
        Some(PROPERTY_HEADER) => {}
        Some(PROPERTY_ENCODED_HEADER) => {
            // The blob describes where the real header is packed. Parse that description first, so
            // the sizes it declares are checked before the reader allocates against them — and so
            // the third range is named exactly rather than guessed at.
            let packed = describe_packed_header(next_header, archive_size, limits)?;
            if slice_of(ranges, packed.offset, packed.size).is_none() {
                return Ok(ListOutcome::NeedRange {
                    offset: packed.offset,
                    length: packed.size,
                });
            }
        }
        _ => {
            return Err(malformed(
                "next header is neither a header nor an encoded header",
            ))
        }
    }

    let mut reader = SparseReader::new(ranges, archive_size);
    let archive = Archive::read(&mut reader, archive_size, &[]).map_err(read_error)?;
    Ok(ListOutcome::Listing(to_listing(&archive, limits)))
}

/// List an archive already held whole in memory. The ranged form above is the one to reach for on a
/// stored object; this is for a small archive that is already a byte slice.
pub fn list_bytes(bytes: &[u8], limits: &ListLimits) -> Result<SevenZipListing, ListError> {
    let ranges = [ArchiveRange::new(0, bytes.to_vec())];
    match list(bytes.len() as u64, &ranges, limits)? {
        ListOutcome::Listing(listing) => Ok(listing),
        // Unreachable for a whole-archive range, and a refusal rather than an unwrap if the range
        // planner ever asks for something outside the buffer it was given.
        ListOutcome::NeedRange { .. } => Err(ListError::RangeMismatch),
    }
}

/// Where the packed header sits and how big it is.
struct PackedHeader {
    offset: u64,
    size: u64,
}

/// Read the encoded header's own description of itself, and refuse it if what it declares would
/// make the reader allocate more than the caller allowed.
///
/// The description is a streams-info block, which is the same structure the reader already knows
/// how to parse — so rather than hand-decoding it, it is wrapped as the main streams info of a
/// throwaway in-memory archive and handed straight back to the reader. One parser, used twice.
fn describe_packed_header(
    next_header: &[u8],
    archive_size: u64,
    limits: &ListLimits,
) -> Result<PackedHeader, ListError> {
    let streams_info = next_header
        .get(1..)
        .ok_or_else(|| malformed("encoded header has no streams info"))?;

    let mut synthetic_header = Vec::with_capacity(streams_info.len() + 3);
    synthetic_header.push(PROPERTY_HEADER);
    synthetic_header.push(PROPERTY_MAIN_STREAMS_INFO);
    synthetic_header.extend_from_slice(streams_info);
    synthetic_header.push(PROPERTY_END);

    let mut synthetic = start_header_for(&synthetic_header);
    synthetic.extend_from_slice(&synthetic_header);
    let length = synthetic.len() as u64;
    let outer = Archive::read(&mut Cursor::new(synthetic), length, &[]).map_err(read_error)?;

    let folder = outer
        .folders
        .first()
        .ok_or_else(|| malformed("encoded header names no folder"))?;
    let size = *outer
        .pack_sizes
        .first()
        .ok_or_else(|| malformed("encoded header names no packed stream"))?;

    let offset = START_HEADER_BYTES
        .checked_add(outer.pack_pos)
        .ok_or_else(|| malformed("packed header offset overflows"))?;
    let end = offset
        .checked_add(size)
        .ok_or_else(|| malformed("packed header size overflows"))?;
    if end > archive_size {
        return Err(malformed("packed header runs past the end of the object"));
    }
    if size > limits.max_header_bytes {
        return Err(ListError::TooLarge {
            limit: limits.max_header_bytes,
            declared: size,
        });
    }

    let decoded = folder.get_unpack_size();
    if decoded > limits.max_decoded_header_bytes {
        return Err(ListError::TooLarge {
            limit: limits.max_decoded_header_bytes,
            declared: decoded,
        });
    }
    for coder in &folder.coders {
        check_header_coder(coder.decompression_method_id(), &coder.properties, limits)?;
    }

    Ok(PackedHeader { offset, size })
}

/// Whether the reader may be pointed at this coder, decided before it is.
///
/// Three things go wrong here and each is fatal in a different way. An AES coder means the file
/// list is encrypted and cannot be listed at all. An LZMA coder with fewer than five property bytes
/// makes the decoder index off the end of the slice. And both LZMA dialects take their dictionary
/// size from a property the archive chooses freely, then allocate a buffer that size before reading
/// a byte — so a header five bytes long can ask for four gigabytes.
fn check_header_coder(
    method_id: &[u8],
    properties: &[u8],
    limits: &ListLimits,
) -> Result<(), ListError> {
    if method_id == SevenZMethod::ID_AES256SHA256 {
        return Err(ListError::HeaderEncrypted);
    }
    let dictionary_bytes = if method_id == SevenZMethod::ID_LZMA {
        let raw = properties
            .get(1..5)
            .ok_or_else(|| malformed("LZMA properties too short"))?;
        u64::from(u32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]))
    } else if method_id == SevenZMethod::ID_LZMA2 {
        let bits = u32::from(
            *properties
                .first()
                .ok_or_else(|| malformed("LZMA2 properties too short"))?,
        );
        if bits > 40 {
            return Err(malformed("LZMA2 dictionary larger than the format allows"));
        }
        if bits == 40 {
            u64::from(u32::MAX)
        } else {
            u64::from(2 | (bits & 1)) << (bits / 2 + 11)
        }
    } else {
        // Everything else here is a filter or a passthrough with no size-driven allocation. An
        // unknown one is caught by the reader, which refuses rather than guessing.
        if SevenZMethod::by_id(method_id).is_none() {
            return Err(ListError::UnsupportedCoder(Cow::Borrowed("unknown")));
        }
        return Ok(());
    };
    if dictionary_bytes > limits.max_dictionary_bytes {
        return Err(ListError::TooLarge {
            limit: limits.max_dictionary_bytes,
            declared: dictionary_bytes,
        });
    }
    Ok(())
}

/// A start header for an archive whose next header follows immediately, used only for the
/// throwaway archive the encoded-header description is parsed as.
fn start_header_for(next_header: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(20);
    body.extend_from_slice(&0u64.to_le_bytes());
    body.extend_from_slice(&(next_header.len() as u64).to_le_bytes());
    body.extend_from_slice(&crc32fast::hash(next_header).to_le_bytes());

    let mut header = Vec::with_capacity(32);
    header.extend_from_slice(&SIGNATURE);
    header.extend_from_slice(&[0x00, 0x04]);
    header.extend_from_slice(&crc32fast::hash(&body).to_le_bytes());
    header.extend_from_slice(&body);
    header
}

fn to_listing(archive: &Archive, limits: &ListLimits) -> SevenZipListing {
    let truncated = archive.files.len() > limits.max_entries;
    let entries = archive
        .files
        .iter()
        .take(limits.max_entries)
        .enumerate()
        .map(|(index, file)| SevenZipEntry {
            path: normalize_path(&file.name),
            is_directory: file.is_directory,
            compressed_size_bytes: file.compressed_size,
            uncompressed_size_bytes: file.size,
            modified_at_epoch_millis: file
                .has_last_modified_date
                .then(|| file.last_modified_date.to_unix_time_millis()),
            encrypted: entry_is_encrypted(archive, index),
        })
        .collect();
    SevenZipListing { entries, truncated }
}

/// Whether the block this member's content lives in is AES-encrypted. A member with no content
/// stream — a directory, or an empty file — belongs to no block and is never encrypted.
fn entry_is_encrypted(archive: &Archive, index: usize) -> bool {
    let Some(Some(folder_index)) = archive.stream_map.file_folder_index.get(index).copied() else {
        return false;
    };
    let Some(folder) = archive.folders.get(folder_index) else {
        return false;
    };
    folder
        .coders
        .iter()
        .any(|coder| coder.decompression_method_id() == SevenZMethod::ID_AES256SHA256)
}

/// A member path as the listing presents it: forward slashes and no leading slash, matching what the
/// zip and tar listings answer with so no archive can present a path that reads as somewhere else.
///
/// Unlike those, this does not drop a traversing path. A 7z stores names the encoder wrote and this
/// layer's job is to report them; the surface that turns a listed path into a destination is where a
/// `..` has to be refused, and it refuses it for every format at once.
fn normalize_path(raw: &str) -> String {
    raw.replace('\\', "/").trim_start_matches('/').to_owned()
}

/// Map the reader's failure onto a refusal. The reasons are folded into a small set on purpose:
/// they cross into JavaScript, and a caller branching on a code must not be reading a sentence that
/// could name part of an archive.
fn read_error(error: sevenz_rust2::Error) -> ListError {
    use sevenz_rust2::Error;
    match error {
        Error::BadSignature(_) => ListError::NotSevenZip,
        Error::UnsupportedVersion { .. } => ListError::UnsupportedVersion,
        Error::PasswordRequired | Error::MaybeBadPassword(_) => ListError::HeaderEncrypted,
        Error::UnsupportedCompressionMethod(name) => {
            // Reached when the aes256 feature is off, which is how this crate is built: an
            // AES-encrypted file list arrives named rather than decoded.
            if name == SevenZMethod::AES256SHA256.name() {
                ListError::HeaderEncrypted
            } else {
                ListError::UnsupportedCoder(Cow::Owned(name))
            }
        }
        Error::MaxMemLimited { max_kb, actaul_kb } => ListError::TooLarge {
            limit: (max_kb as u64).saturating_mul(1024),
            declared: (actaul_kb as u64).saturating_mul(1024),
        },
        _ => malformed("header could not be read"),
    }
}

/// The bytes of `[offset, offset + length)` if one supplied range holds all of them.
fn slice_of(ranges: &[ArchiveRange], offset: u64, length: u64) -> Option<&[u8]> {
    let range = ranges.iter().find(|range| range.covers(offset, length))?;
    let start = usize::try_from(offset - range.offset).ok()?;
    let end = start.checked_add(usize::try_from(length).ok()?)?;
    range.bytes.get(start..end)
}

/// A `Read + Seek` over the ranges the caller fetched, and nothing else.
///
/// This is what keeps a listing from becoming a download: the reader is free to seek anywhere in an
/// archive of any size, but a read outside a supplied range fails rather than being satisfied. Every
/// range the reader will ask for has already been named by the planning above, so a miss here means
/// the header pointed somewhere the header itself said it would not.
struct SparseReader<'a> {
    ranges: &'a [ArchiveRange],
    size: u64,
    position: u64,
}

impl<'a> SparseReader<'a> {
    fn new(ranges: &'a [ArchiveRange], size: u64) -> Self {
        Self {
            ranges,
            size,
            position: 0,
        }
    }
}

impl Read for SparseReader<'_> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if buf.is_empty() || self.position >= self.size {
            return Ok(0);
        }
        let range = self
            .ranges
            .iter()
            .find(|range| range.offset <= self.position && self.position < range.end())
            .ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "read outside the fetched ranges",
                )
            })?;
        let start = (self.position - range.offset) as usize;
        let available = range.bytes.len() - start;
        let taken = available.min(buf.len());
        buf[..taken].copy_from_slice(&range.bytes[start..start + taken]);
        self.position += taken as u64;
        Ok(taken)
    }
}

impl Seek for SparseReader<'_> {
    fn seek(&mut self, from: SeekFrom) -> std::io::Result<u64> {
        // Seeking is free — only reading needs bytes in hand — so any in-object position is allowed
        // and a read decides whether the bytes are actually there.
        let target = match from {
            SeekFrom::Start(offset) => Some(offset),
            SeekFrom::End(delta) => self.size.checked_add_signed(delta),
            SeekFrom::Current(delta) => self.position.checked_add_signed(delta),
        };
        let target = target.ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "seek out of range")
        })?;
        self.position = target;
        Ok(target)
    }
}
