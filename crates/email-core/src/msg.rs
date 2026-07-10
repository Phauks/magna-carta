//! The `.msg` lane's container gate: open the CFB/OLE2 compound file that an
//! Outlook `.msg` is wrapped in, mapping every structural fault to a single
//! opaque [`EmailError::Malformed`]. The MAPI property-stream decoding that reads
//! the sender, recipients, subject, body, and attachments out of the opened
//! container is built above this gate, with its own bounds.
//!
//! Why a dedicated open helper rather than calling `cfb` at each use site: the
//! bytes are attacker-controlled and legally privileged, and this engine runs in
//! an isolate that cannot unwind. Funneling every open through one point keeps the
//! error mapping uniform (no `cfb` message text, which could echo input, ever
//! reaches a caller) and gives the panic-safety regression tests below a single,
//! stable surface to hold `cfb` to.

use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};

use cfb::CompoundFile;
use mail_parser::MessageParser;

use crate::error::EmailError;
use crate::limits::Limits;
use crate::model::{
    Address, Disposition, IntegrityFacts, MessageIdentifier, ParsedMessage, PartDescriptor,
    PartLocator, SourceFormat,
};

/// The container-open seam for `.msg`: open a compound-file wrapper over an
/// in-memory cursor, without copying the input. Any structural fault `cfb`
/// reports while reading the header, DIFAT/FAT, directory, or MiniFAT
/// collapses to [`EmailError::Malformed`] — the underlying `io::Error` text is
/// dropped so no fragment of the input can ride out on an error path.
///
/// That collapse matters beyond tidiness: this parser ends up running in a
/// wasm isolate that cannot unwind, so a `cfb` panic on hostile input would
/// abort the whole isolate rather than hand the caller a recoverable result.
/// Mapping every fault to one plain, static-string error variant is what
/// keeps a malformed attachment a normal `Err` instead of a crash.
///
/// Kept `pub` (not crate-private) on purpose. Monomorphization is lazy: a
/// crate-private function whose only caller is test-only code is never
/// generated, and neither is anything it calls — so `cfb`'s open/read path
/// would silently go uncompiled on wasm, and a build that never touched it
/// would still look green. Being `pub` makes it an `rlib` export, which is a
/// codegen root, so the compiler really does generate `cfb`'s generic open
/// path for `Cursor<&[u8]>`.
///
/// That root comes from the `rlib` half of this crate's `crate-type`, not
/// from `pub` alone: a plain Rust function is not a `cdylib` export, so
/// trimming `crate-type` to `["cdylib"]` would drop `cfb` from the artifact
/// again (measurably — it nearly halves it). Once the MAPI decoder is
/// reachable from a `#[wasm_bindgen]` entry point, that export graph roots
/// this path directly and the `rlib` scaffold stops mattering.
pub fn open_compound_file(bytes: &[u8]) -> Result<CompoundFile<Cursor<&[u8]>>, EmailError> {
    CompoundFile::open(Cursor::new(bytes)).map_err(|_| EmailError::Malformed)
}

/// A `.msg` is a compound file of MAPI property streams. This reads the sender,
/// recipients, subject, bodies, and attachment descriptors out of one, per
/// [MS-OXMSG] / [MS-OXPROPS], and returns the same [`ParsedMessage`] the `.eml`
/// lane produces so a caller need not know which container an email arrived in.
///
/// The bytes are attacker-controlled and legally privileged, and this runs in an
/// isolate that cannot unwind, so every value derived from the input is
/// bounds-checked: no slice is indexed without a length test, no allocation is
/// sized by an attacker-declared length, no `unwrap`/`expect`/`panic` touches
/// input-derived data. Every malformed structure becomes [`EmailError::Malformed`].
pub fn parse_msg(bytes: &[u8]) -> Result<ParsedMessage, EmailError> {
    parse_msg_with_limits(bytes, &Limits::default())
}

/// The `.msg` lane with explicit caps. The embedding-depth cap is honored from
/// `limits` rather than a hardcoded constant, so the whole engine shares one
/// embedded-message bound; the input-size cap is checked before the container opens.
pub fn parse_msg_with_limits(bytes: &[u8], limits: &Limits) -> Result<ParsedMessage, EmailError> {
    if bytes.len() > limits.max_input_bytes {
        return Err(EmailError::LimitExceeded);
    }
    let mut compound = open_compound_file(bytes)?;
    // Walk the whole directory tree once into owned paths. `cfb`'s walk is
    // bounds-checked and cycle-guarded, and collecting it up front releases the
    // immutable borrow so the property streams can then be opened for reading.
    let nodes: Vec<Node> = compound
        .walk()
        .map(|entry| Node {
            path: entry.path().to_path_buf(),
            is_stream: entry.is_stream(),
            length: entry.len(),
        })
        .collect();
    let index = NodeIndex::build(nodes);
    let mut counters = BreadthCounters::default();
    read_message(
        &mut compound,
        &index,
        Path::new("/"),
        HEADER_TOP_LEVEL,
        0,
        limits,
        &mut counters,
    )
}

/// Running breadth totals shared across the whole embedded-message recursion, bundled
/// into one struct so `read_message`/`read_attachments` take one extra parameter
/// instead of two — `clippy::too_many_arguments` otherwise trips on `read_message`,
/// which already carries the container, the node index, the current path, the
/// property-stream header size, the recursion depth, and the caps. An attachment
/// that is itself an embedded message adds to these same counts rather than
/// resetting either back to zero on the way in, matching how the `.eml` lane's
/// `enforce_message_limits` threads a single `total_parts` through its own recursion.
#[derive(Default)]
struct BreadthCounters {
    total_parts: usize,
    total_recipients: usize,
}

/// The container this decoder runs against: an in-memory cursor over borrowed input.
pub(crate) type Msg<'a> = CompoundFile<Cursor<&'a [u8]>>;

/// One directory entry, captured as owned data so reading a stream (which needs a
/// mutable borrow of the container) does not conflict with tree traversal.
struct Node {
    path: PathBuf,
    is_stream: bool,
    length: u64,
}

/// Directory entries grouped by parent path, built once per parse. Every lookup below
/// (a storage's substreams, a storage's fixed-property stream, the sub-storages
/// matching a name prefix) used to rescan the entire flat node list per call, which
/// made a message with many sibling storages cost `O(nodes * storages)` rather than
/// `O(nodes)` — quadratic in a container an attacker fully controls. Grouping once by
/// parent turns every one of those lookups into a walk of just that parent's own
/// children.
struct NodeIndex {
    nodes: Vec<Node>,
    children_by_parent: HashMap<PathBuf, Vec<usize>>,
}

impl NodeIndex {
    fn build(nodes: Vec<Node>) -> Self {
        let mut children_by_parent: HashMap<PathBuf, Vec<usize>> = HashMap::new();
        for (position, node) in nodes.iter().enumerate() {
            if let Some(parent) = node.path.parent() {
                children_by_parent
                    .entry(parent.to_path_buf())
                    .or_default()
                    .push(position);
            }
        }
        Self {
            nodes,
            children_by_parent,
        }
    }

    /// The direct children of `prefix`, in the order `cfb`'s walk produced them.
    fn children_of<'a>(&'a self, prefix: &Path) -> impl Iterator<Item = &'a Node> {
        self.children_by_parent
            .get(prefix)
            .into_iter()
            .flatten()
            .map(move |&position| &self.nodes[position])
    }
}

/// A variable-length property, stored in its own `__substg1.0_<id><type>` stream.
struct SubStream {
    id: u16,
    property_type: u16,
    path: PathBuf,
    length: u64,
}

/// A fixed-length property, stored inline in the `__properties_version1.0` stream.
struct FixedProperty {
    id: u16,
    property_type: u16,
    value: [u8; 8],
}

// Property identifiers ([MS-OXPROPS]). Names spelled out; the numeric tags are the
// wire identifiers the format defines.
const PID_TRANSPORT_MESSAGE_HEADERS: u16 = 0x007D;
const PID_INTERNET_MESSAGE_ID: u16 = 0x1035;
const PID_SUBJECT: u16 = 0x0037;
const PID_SENDER_NAME: u16 = 0x0C1A;
const PID_SENDER_SMTP_ADDRESS: u16 = 0x0C1F;
const PID_SENDER_SMTP_ADDRESS_FALLBACK: u16 = 0x5D01;
const PID_MESSAGE_DELIVERY_TIME: u16 = 0x0E06;
const PID_BODY: u16 = 0x1000;
const PID_HTML: u16 = 0x1013;
const PID_RECIPIENT_DISPLAY_NAME: u16 = 0x3001;
const PID_RECIPIENT_SMTP_ADDRESS: u16 = 0x39FE;
const PID_RECIPIENT_EMAIL_ADDRESS_FALLBACK: u16 = 0x3003;
const PID_RECIPIENT_TYPE: u16 = 0x0C15;
const PID_ATTACH_LONG_FILENAME: u16 = 0x3707;
const PID_ATTACH_FILENAME_FALLBACK: u16 = 0x3704;
const PID_ATTACH_MIME_TAG: u16 = 0x370E;
const PID_ATTACH_CONTENT_ID: u16 = 0x3712;
const PID_ATTACH_DATA: u16 = 0x3701;
const PID_ATTACH_METHOD: u16 = 0x3705;

// Property types ([MS-OXCDATA]).
const PTYPE_INT32: u16 = 0x0003;
const PTYPE_FILETIME: u16 = 0x0040;
const PTYPE_STRING8: u16 = 0x001E;
const PTYPE_UNICODE: u16 = 0x001F;
const PTYPE_BINARY: u16 = 0x0102;

// Recipient classes ([MS-OXOMSG] PidTagRecipientType).
const RECIPIENT_TYPE_CC: i32 = 2;
const RECIPIENT_TYPE_BCC: i32 = 3;

// PidTagAttachMethod value that marks an attachment as an embedded message object.
const ATTACH_METHOD_EMBEDDED_MESSAGE: i32 = 0x05;

// The `__properties_version1.0` stream begins with a reserved header whose size
// depends on the object it describes ([MS-OXMSG] 2.4.1): 32 bytes for the top-level
// message, 24 for an embedded message, 8 for a recipient or attachment object.
const HEADER_TOP_LEVEL: usize = 32;
const HEADER_EMBEDDED_MESSAGE: usize = 24;
const HEADER_SUBOBJECT: usize = 8;

/// A stream read is clamped to this many bytes. `cfb` never yields more than the
/// real sector chain holds (so this cannot be inflated past the input), and this
/// engine only reads small property streams — a body, a header block — not the
/// attachment payloads, whose sizes it takes from the directory without reading
/// them. The clamp is a second wall so no crafted directory entry can turn a
/// property read into an unbounded allocation.
const MAX_PROPERTY_STREAM_BYTES: u64 = 64 * 1024 * 1024;

/// Parse the message object rooted at `prefix` (the container root for a top-level
/// `.msg`, or an embedded-message sub-storage on a recursive call). `header_size` is
/// the property-stream header for this object class; `depth` counts embedding.
///
/// The embedding-depth bound comes from [`Limits::max_embedded_message_depth`] so the
/// `.msg` lane and the `.eml` lane share one embedded-message cap rather than each
/// carrying its own constant. It matters because an attachment can itself be an
/// embedded `.msg`, which can embed another without limit: this engine runs where the
/// stack cannot unwind, so an over-deep chain is a stack-exhaustion bomb rather than
/// real correspondence (a forwarded-as-attachment thread is a handful of levels, never
/// dozens). Descending past the bound is refused with [`EmailError::LimitExceeded`].
///
/// `counters` holds running totals shared across the whole recursion, mirroring how
/// the `.eml` lane's `enforce_message_limits` accumulates a single `total_parts`
/// across embedded `message/rfc822` nodes: a `.msg` attachment that is itself an
/// embedded message must not reset either count back to zero, or an attacker could
/// bypass the breadth cap entirely just by nesting.
fn read_message(
    compound: &mut Msg,
    index: &NodeIndex,
    prefix: &Path,
    header_size: usize,
    depth: usize,
    limits: &Limits,
    counters: &mut BreadthCounters,
) -> Result<ParsedMessage, EmailError> {
    if depth > limits.max_embedded_message_depth {
        return Err(EmailError::LimitExceeded);
    }

    let substreams = substreams_of(index, prefix);
    let fixed = read_fixed_properties(compound, index, prefix, header_size)?;

    let subject = read_string(compound, &substreams, PID_SUBJECT)?;

    // The sender is a display name and an SMTP address, either of which may be
    // absent; the SMTP address has a documented fallback tag.
    let sender_name = read_string(compound, &substreams, PID_SENDER_NAME)?;
    let sender_address = match read_string(compound, &substreams, PID_SENDER_SMTP_ADDRESS)? {
        Some(address) => Some(address),
        None => read_string(compound, &substreams, PID_SENDER_SMTP_ADDRESS_FALLBACK)?,
    };
    let from = if sender_name.is_some() || sender_address.is_some() {
        vec![Address {
            display_name: sender_name,
            address: sender_address,
        }]
    } else {
        Vec::new()
    };

    let date_raw = fixed_filetime_iso(&fixed, PID_MESSAGE_DELIVERY_TIME);

    // Bodies. The RTF body (PidTagRtfCompressed, 0x1009) is LZFu-compressed and is
    // not decoded here, so a `.msg` whose only body is RTF currently yields no body
    // text at all; `rtf_body` stays `None` rather than pretending otherwise. Plain
    // text and HTML are read directly.
    let text_bodies: Vec<String> = read_string(compound, &substreams, PID_BODY)?
        .into_iter()
        .collect();
    let html_bodies: Vec<String> = read_binary_as_text(compound, &substreams, PID_HTML)?
        .into_iter()
        .collect();
    let references_remote_content = html_bodies.iter().any(|body| {
        let lowered = body.to_ascii_lowercase();
        lowered.contains("src=\"http://") || lowered.contains("src=\"https://")
    });

    let (to, cc, bcc) = read_recipients(compound, index, prefix, limits, counters)?;
    let parts = read_attachments(compound, index, prefix, depth, limits, counters)?;

    // Header provenance is load-bearing. A `.msg` carries RFC 5322 headers only when
    // PidTagTransportMessageHeaders survived export; when it did, its Message-ID is a
    // real header value. When it did not, an identifier can still be recovered from
    // PidTagInternetMessageId, but that is a MAPI value, not a header one, and must be
    // marked as such so downstream dedup never treats the two as interchangeable.
    let header_block = read_string(compound, &substreams, PID_TRANSPORT_MESSAGE_HEADERS)?;
    let header_derived = header_block.as_deref().and_then(parse_header_block);
    let mapi_message_id = read_string(compound, &substreams, PID_INTERNET_MESSAGE_ID)?;

    let (raw_headers, integrity, in_reply_to, references, header_identifier) = match header_derived
    {
        Some(derived) => (
            derived.raw_headers,
            derived.integrity,
            derived.in_reply_to,
            derived.references,
            derived.message_identifier,
        ),
        None => (
            Vec::new(),
            IntegrityFacts::default(),
            None,
            Vec::new(),
            MessageIdentifier::Absent,
        ),
    };
    let message_identifier = match header_identifier {
        MessageIdentifier::FromHeader(value) => MessageIdentifier::FromHeader(value),
        // No header-sourced Message-ID: fall back to the MAPI value, tagged as MAPI.
        _ => match mapi_message_id {
            Some(value) => MessageIdentifier::FromMapi(value),
            None => MessageIdentifier::Absent,
        },
    };

    Ok(ParsedMessage {
        message_identifier,
        in_reply_to,
        references,
        subject,
        date_raw,
        from,
        to,
        cc,
        bcc,
        raw_headers,
        text_bodies,
        html_bodies,
        // PidTagRtfCompressed (0x1009) uses LZFu compression and is decoded elsewhere.
        rtf_body: None,
        parts,
        integrity,
        source_format: SourceFormat::Msg,
        references_remote_content,
    })
}

/// Recipients live in `__recip_version1.0_#XXXXXXXX` sub-storages; each carries its
/// own display name, SMTP address (with a fallback tag), and recipient class.
///
/// The recipient count at this level is added to `counters.total_recipients` and
/// checked against [`Limits::max_recipient_count`] before any storage is opened, the
/// same way the `.eml` lane checks its part-count total before walking the parts it
/// counted: a directory crafted with far more recipient storages than any real
/// message would carry is refused for its breadth alone, not decoded one recipient at
/// a time.
#[allow(clippy::type_complexity)]
fn read_recipients(
    compound: &mut Msg,
    index: &NodeIndex,
    prefix: &Path,
    limits: &Limits,
    counters: &mut BreadthCounters,
) -> Result<(Vec<Address>, Vec<Address>, Vec<Address>), EmailError> {
    let mut to = Vec::new();
    let mut cc = Vec::new();
    let mut bcc = Vec::new();

    let storages = storages_named(index, prefix, "__recip_version1.0_");
    counters.total_recipients = counters.total_recipients.saturating_add(storages.len());
    if counters.total_recipients > limits.max_recipient_count {
        return Err(EmailError::LimitExceeded);
    }

    for storage in storages {
        let substreams = substreams_of(index, &storage);
        let fixed = read_fixed_properties(compound, index, &storage, HEADER_SUBOBJECT)?;

        let display_name = read_string(compound, &substreams, PID_RECIPIENT_DISPLAY_NAME)?;
        let address = match read_string(compound, &substreams, PID_RECIPIENT_SMTP_ADDRESS)? {
            Some(value) => Some(value),
            None => read_string(compound, &substreams, PID_RECIPIENT_EMAIL_ADDRESS_FALLBACK)?,
        };
        if display_name.is_none() && address.is_none() {
            continue;
        }
        let recipient = Address {
            display_name,
            address,
        };
        match fixed_int32(&fixed, PID_RECIPIENT_TYPE) {
            Some(RECIPIENT_TYPE_CC) => cc.push(recipient),
            Some(RECIPIENT_TYPE_BCC) => bcc.push(recipient),
            // To (1), Originator (0), or anything unrecognized: treat as a To recipient.
            _ => to.push(recipient),
        }
    }

    Ok((to, cc, bcc))
}

/// Attachments live in `__attach_version1.0_#XXXXXXXX` sub-storages. Each becomes a
/// [`PartDescriptor`] located by a named stream — never by an input range, since a
/// `.msg` part's bytes are reassembled from scattered sectors, not a span of the
/// input. The locator names the attachment-data stream itself (`__substg1.0_37010102`)
/// so `extract_part` can re-open the container and read exactly those bytes; an
/// embedded-message attachment, which has no flat data stream, is located by its
/// storage instead (its bytes are a nested message, not a materializable blob).
///
/// The attachment count at this level is added to `counters.total_parts` and checked
/// against [`Limits::max_part_count`] before any storage is opened — mirroring the
/// `.eml` lane's `enforce_message_limits`, which adds a message's whole `parts.len()`
/// to its running total and checks the bound before walking a single one of them. A
/// directory crafted with far more attachment storages than the cap allows is refused
/// for its breadth alone; the `.eml` lane already refuses the same shape (a
/// `multipart/mixed` with more children than `max_part_count`) the same way, so the
/// two lanes agree on what "too many parts" means even though a `.msg` part and a MIME
/// part are read out of differently shaped containers.
fn read_attachments(
    compound: &mut Msg,
    index: &NodeIndex,
    prefix: &Path,
    depth: usize,
    limits: &Limits,
    counters: &mut BreadthCounters,
) -> Result<Vec<PartDescriptor>, EmailError> {
    let mut parts = Vec::new();

    let storages = storages_named(index, prefix, "__attach_version1.0_");
    counters.total_parts = counters.total_parts.saturating_add(storages.len());
    if counters.total_parts > limits.max_part_count {
        return Err(EmailError::LimitExceeded);
    }

    for storage in storages {
        let substreams = substreams_of(index, &storage);
        let fixed = read_fixed_properties(compound, index, &storage, HEADER_SUBOBJECT)?;

        let filename = match read_string(compound, &substreams, PID_ATTACH_LONG_FILENAME)? {
            Some(name) => Some(name),
            None => read_string(compound, &substreams, PID_ATTACH_FILENAME_FALLBACK)?,
        };
        let media_type = read_string(compound, &substreams, PID_ATTACH_MIME_TAG)?;
        let content_identifier = read_string(compound, &substreams, PID_ATTACH_CONTENT_ID)?;
        // The data stream carries the payload. Its directory-recorded length is the
        // part size (a part is described here, materialized only on demand), and its
        // path is the locator so extraction reads the payload stream directly.
        let data_stream = find_substream(&substreams, PID_ATTACH_DATA, PTYPE_BINARY);
        let size = data_stream.map(|stream| stream.length).unwrap_or(0);
        let locator_name = match data_stream {
            Some(stream) => storage_locator_name(&stream.path),
            None => storage_locator_name(&storage),
        };
        let is_embedded_message =
            fixed_int32(&fixed, PID_ATTACH_METHOD) == Some(ATTACH_METHOD_EMBEDDED_MESSAGE);
        let disposition = if content_identifier.is_some() {
            Disposition::Inline
        } else {
            Disposition::Attachment
        };

        parts.push(PartDescriptor {
            filename,
            media_type,
            content_identifier,
            disposition,
            size: clamp_to_usize(size),
            locator: PartLocator::MapiStream { name: locator_name },
            is_embedded_message,
        });

        // An embedded message object is a nested compound-file sub-storage. Descend it
        // to bound the embedding depth and to reject a malformed nested message rather
        // than trusting bytes we did not validate. Its decoded content is not surfaced
        // as a nested record yet; that is a later slice. The recursion guard lives here
        // because this descent is the recursion.
        if let Some(embedded) = embedded_message_storage(index, &storage) {
            read_message(
                compound,
                index,
                &embedded,
                HEADER_EMBEDDED_MESSAGE,
                depth + 1,
                limits,
                counters,
            )?;
        }
    }

    Ok(parts)
}

/// Parse an RFC 5322 header block recovered from PidTagTransportMessageHeaders,
/// reusing the `.eml` lane's tested header extraction so the ordered verbatim
/// headers, the Message-ID provenance, and the integrity facts are read exactly as
/// they are from a standalone `.eml`. `None` when the block parses to nothing.
fn parse_header_block(block: &str) -> Option<ParsedMessage> {
    // A bare header block has no body separator; append one so the parser treats
    // every line as a header rather than folding a trailing line into a body. The
    // appended bytes sit past the header region and do not shift any header offset.
    let mut buffer = block.as_bytes().to_vec();
    buffer.extend_from_slice(b"\r\n\r\n");
    let message = MessageParser::default().parse(&buffer)?;
    Some(crate::eml::from_mail_parser_message(
        &message,
        SourceFormat::Msg,
    ))
}

/// The variable-length property streams that are direct children of `prefix`.
fn substreams_of(index: &NodeIndex, prefix: &Path) -> Vec<SubStream> {
    index
        .children_of(prefix)
        .filter(|node| node.is_stream)
        .filter_map(|node| {
            let name = node.path.file_name()?.to_str()?;
            let (id, property_type) = parse_substg_name(name)?;
            Some(SubStream {
                id,
                property_type,
                path: node.path.clone(),
                length: node.length,
            })
        })
        .collect()
}

/// Sub-storages directly under `prefix` whose name begins with `name_prefix`.
fn storages_named(index: &NodeIndex, prefix: &Path, name_prefix: &str) -> Vec<PathBuf> {
    index
        .children_of(prefix)
        .filter(|node| !node.is_stream)
        .filter(|node| {
            node.path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(name_prefix))
        })
        .map(|node| node.path.clone())
        .collect()
}

/// The embedded-message sub-storage of an attachment, if present. [MS-OXMSG] stores
/// an embedded message object under the attachment-data tag with the object type.
fn embedded_message_storage(index: &NodeIndex, attachment: &Path) -> Option<PathBuf> {
    index
        .children_of(attachment)
        .find(|node| {
            !node.is_stream
                && node.path.file_name().and_then(|name| name.to_str())
                    == Some("__substg1.0_3701000D")
        })
        .map(|node| node.path.clone())
}

/// Split a `__substg1.0_<id><type>` stream name into its property id and type. The
/// eight characters after the prefix are hex: four of property id, four of type.
/// A name that is not exactly that shape yields `None` and is ignored.
///
/// A CFB directory entry name is arbitrary Unicode by the time `cfb` hands it back
/// as a `&str` — it started life as UTF-16 in the container and can decode to any
/// scalar value, not just the ASCII this tag shape expects. `hex.len()` counts
/// bytes, not characters, so an 8-*byte* string can still contain a multi-byte
/// character; slicing at a fixed byte offset like `4` would then land inside that
/// character instead of on a boundary between two of them, which panics. Checking
/// `is_ascii()` first rules that out: once every byte is one of the 128 ASCII
/// scalars, each byte *is* one character, so byte offsets and char boundaries are
/// the same thing and the fixed-offset slices below are always safe.
fn parse_substg_name(name: &str) -> Option<(u16, u16)> {
    let hex = name.strip_prefix("__substg1.0_")?;
    if hex.len() != 8 || !hex.is_ascii() {
        return None;
    }
    let id = u16::from_str_radix(&hex[0..4], 16).ok()?;
    let property_type = u16::from_str_radix(&hex[4..8], 16).ok()?;
    Some((id, property_type))
}

/// Read a string property, preferring the Unicode (UTF-16LE) form and falling back
/// to the 8-bit form. `Err` only when a present Unicode stream is malformed.
fn read_string(
    compound: &mut Msg,
    substreams: &[SubStream],
    property_id: u16,
) -> Result<Option<String>, EmailError> {
    if let Some(stream) = find_substream(substreams, property_id, PTYPE_UNICODE) {
        let bytes = read_stream_bounded(compound, &stream.path)?;
        return Ok(Some(decode_utf16le(&bytes)?));
    }
    if let Some(stream) = find_substream(substreams, property_id, PTYPE_STRING8) {
        let bytes = read_stream_bounded(compound, &stream.path)?;
        return Ok(Some(decode_string8(&bytes)));
    }
    Ok(None)
}

/// Read a binary property (e.g. PidTagHtml) as text. HTML bytes are decoded
/// UTF-8-lossily; the byte-exact form remains available through the part descriptors.
fn read_binary_as_text(
    compound: &mut Msg,
    substreams: &[SubStream],
    property_id: u16,
) -> Result<Option<String>, EmailError> {
    if let Some(stream) = find_substream(substreams, property_id, PTYPE_BINARY) {
        let bytes = read_stream_bounded(compound, &stream.path)?;
        return Ok(Some(String::from_utf8_lossy(&bytes).into_owned()));
    }
    Ok(None)
}

fn find_substream(
    substreams: &[SubStream],
    property_id: u16,
    property_type: u16,
) -> Option<&SubStream> {
    substreams
        .iter()
        .find(|stream| stream.id == property_id && stream.property_type == property_type)
}

/// Read the fixed-length properties out of the `__properties_version1.0` stream of
/// the object at `prefix`, if it has one. Absence is not an error.
fn read_fixed_properties(
    compound: &mut Msg,
    index: &NodeIndex,
    prefix: &Path,
    header_size: usize,
) -> Result<Vec<FixedProperty>, EmailError> {
    let node = index.children_of(prefix).find(|node| {
        node.is_stream
            && node.path.file_name().and_then(|name| name.to_str())
                == Some("__properties_version1.0")
    });
    match node {
        Some(node) => {
            let bytes = read_stream_bounded(compound, &node.path)?;
            Ok(parse_fixed_properties(&bytes, header_size))
        }
        None => Ok(Vec::new()),
    }
}

/// Decode the fixed 16-byte property records that follow the reserved header. Each
/// record is a tag (property id and type), flags, then an 8-byte value. A trailing
/// partial record is ignored — `chunks_exact` never yields short slices, so no read
/// runs off the end.
fn parse_fixed_properties(bytes: &[u8], header_size: usize) -> Vec<FixedProperty> {
    if bytes.len() <= header_size {
        return Vec::new();
    }
    bytes[header_size..]
        .chunks_exact(16)
        .map(|record| {
            let tag = u32::from_le_bytes([record[0], record[1], record[2], record[3]]);
            let mut value = [0u8; 8];
            value.copy_from_slice(&record[8..16]);
            FixedProperty {
                id: (tag >> 16) as u16,
                property_type: (tag & 0xFFFF) as u16,
                value,
            }
        })
        .collect()
}

fn fixed_int32(properties: &[FixedProperty], property_id: u16) -> Option<i32> {
    properties
        .iter()
        .find(|property| property.id == property_id && property.property_type == PTYPE_INT32)
        .map(|property| {
            i32::from_le_bytes([
                property.value[0],
                property.value[1],
                property.value[2],
                property.value[3],
            ])
        })
}

fn fixed_filetime_iso(properties: &[FixedProperty], property_id: u16) -> Option<String> {
    properties
        .iter()
        .find(|property| property.id == property_id && property.property_type == PTYPE_FILETIME)
        .and_then(|property| filetime_to_iso(property.value))
}

/// Read a stream fully but bounded. The buffer grows only as real bytes arrive
/// (never pre-sized from a declared length), and the read is clamped so a crafted
/// directory entry cannot turn this into an unbounded allocation.
///
/// Kept `pub(crate)` so on-demand part extraction reuses this exact bounded read
/// rather than opening a second, unbounded path to the same streams.
pub(crate) fn read_stream_bounded(compound: &mut Msg, path: &Path) -> Result<Vec<u8>, EmailError> {
    let stream = compound
        .open_stream(path)
        .map_err(|_| EmailError::Malformed)?;
    let mut buffer = Vec::new();
    stream
        .take(MAX_PROPERTY_STREAM_BYTES)
        .read_to_end(&mut buffer)
        .map_err(|_| EmailError::Malformed)?;
    Ok(buffer)
}

/// Read a stream fully, bounded by a caller-supplied cap rather than the fixed
/// property-stream clamp. Used by on-demand part extraction, where a caller may
/// hand in a tighter [`crate::Limits::max_decoded_part_bytes`] than the internal
/// decode paths use — the cap actually applied is never looser than the fixed
/// clamp above, only ever tighter.
///
/// Unlike [`read_stream_bounded`], an over-cap stream is not silently truncated
/// into a shorter, wrong-looking success: one byte past the cap is read so the
/// overage is detected, and detection is reported as [`EmailError::LimitExceeded`].
pub(crate) fn read_stream_bounded_with_cap(
    compound: &mut Msg,
    path: &Path,
    requested_max_bytes: usize,
) -> Result<Vec<u8>, EmailError> {
    let max_bytes = (requested_max_bytes as u64).min(MAX_PROPERTY_STREAM_BYTES);
    let stream = compound
        .open_stream(path)
        .map_err(|_| EmailError::Malformed)?;
    let mut buffer = Vec::new();
    stream
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut buffer)
        .map_err(|_| EmailError::Malformed)?;
    if buffer.len() as u64 > max_bytes {
        return Err(EmailError::LimitExceeded);
    }
    Ok(buffer)
}

/// Decode UTF-16LE. An odd-length buffer cannot be whole 16-bit units, so it is
/// rejected rather than read past its end; a trailing NUL terminator (which Outlook
/// writes) is dropped.
fn decode_utf16le(bytes: &[u8]) -> Result<String, EmailError> {
    if !bytes.len().is_multiple_of(2) {
        return Err(EmailError::Malformed);
    }
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    let decoded = String::from_utf16_lossy(&units);
    Ok(decoded.trim_end_matches('\u{0}').to_owned())
}

/// Decode an 8-bit string property. Its code page is not carried in the stream, so
/// this reads it UTF-8-lossily — correct for the ASCII and UTF-8 that dominate these
/// fields, and lossy (never a panic) for anything else.
fn decode_string8(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .trim_end_matches('\u{0}')
        .to_owned()
}

/// Convert a FILETIME (100-nanosecond ticks since 1601-01-01 UTC) to an ISO 8601
/// UTC timestamp. Pure integer arithmetic, so no input value can panic it; a zero
/// FILETIME (an unset time) yields `None`.
fn filetime_to_iso(value: [u8; 8]) -> Option<String> {
    let ticks = u64::from_le_bytes(value);
    if ticks == 0 {
        return None;
    }
    // FILETIME epoch (1601-01-01) precedes the Unix epoch by 11,644,473,600 seconds.
    let unix_seconds = (ticks / 10_000_000) as i64 - 11_644_473_600;
    let days = unix_seconds.div_euclid(86_400);
    let second_of_day = unix_seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = second_of_day / 3_600;
    let minute = (second_of_day % 3_600) / 60;
    let second = second_of_day % 60;
    Some(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z"
    ))
}

/// Days since the Unix epoch to a civil (year, month, day), by Howard Hinnant's
/// branch-free algorithm. Integer-only; total across the FILETIME range without panic.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = (z - era * 146_097) as u64; // [0, 146_096]
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365; // [0, 399]
    let year = year_of_era as i64 + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100); // [0, 365]
    let month_position = (5 * day_of_year + 2) / 153; // [0, 11]
    let day = (day_of_year - (153 * month_position + 2) / 5 + 1) as u32; // [1, 31]
    let month = if month_position < 10 {
        month_position + 3
    } else {
        month_position - 9
    } as u32; // [1, 12]
    let year = if month <= 2 { year + 1 } else { year };
    (year, month, day)
}

/// A stable, platform-independent handle for a `.msg` part's storage: the directory
/// path with forward slashes, so a later extractor can navigate back to its streams.
fn storage_locator_name(path: &Path) -> String {
    let components: Vec<&str> = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(name) => name.to_str(),
            _ => None,
        })
        .collect();
    format!("/{}", components.join("/"))
}

/// Saturating narrowing of a directory-recorded 64-bit length to the pointer width,
/// so a 32-bit (wasm) target cannot wrap an over-large declared size.
fn clamp_to_usize(value: u64) -> usize {
    usize::try_from(value).unwrap_or(usize::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Build a valid version-4 CFB carrying the given streams, the way a real
    /// `.msg` is structured (a compound file of property streams). Returned as
    /// owned bytes so tests can corrupt copies of it.
    fn valid_compound_file(streams: &[(&str, &[u8])]) -> Vec<u8> {
        let mut compound = CompoundFile::create(Cursor::new(Vec::new())).unwrap();
        for (path, content) in streams {
            compound
                .create_stream(path)
                .unwrap()
                .write_all(content)
                .unwrap();
        }
        compound.flush().unwrap();
        compound.into_inner().into_inner()
    }

    /// A well-formed container opens and its streams read back — the gate does
    /// not reject valid input.
    #[test]
    fn a_valid_compound_file_opens_and_reads() {
        let bytes = valid_compound_file(&[("/__substg1.0_0037001F", b"subject bytes")]);
        let mut compound = open_compound_file(&bytes).expect("valid container opens");
        assert!(compound.exists("/__substg1.0_0037001F"));
        // Walking every entry and reading every stream stays panic-free and bounded.
        let paths: Vec<_> = compound
            .walk()
            .filter(|entry| entry.is_stream())
            .map(|entry| entry.path().to_path_buf())
            .collect();
        for path in paths {
            let mut sink = Vec::new();
            std::io::copy(&mut compound.open_stream(&path).unwrap(), &mut sink).unwrap();
        }
    }

    /// Zero-length input carries no header. Must be a clean `Err`, never a panic.
    #[test]
    fn empty_input_is_malformed() {
        assert!(matches!(
            open_compound_file(&[]),
            Err(EmailError::Malformed)
        ));
    }

    /// Fewer bytes than a CFB header. The length pre-check must reject it.
    #[test]
    fn input_shorter_than_a_header_is_malformed() {
        assert!(matches!(
            open_compound_file(&[0u8; 16]),
            Err(EmailError::Malformed)
        ));
        // The CFB magic alone, with nothing behind it.
        let magic = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
        assert!(matches!(
            open_compound_file(&magic),
            Err(EmailError::Malformed)
        ));
    }

    /// The correct magic followed by garbage where the header fields belong:
    /// wrong byte-order mark / version / sector shift are all rejected, not
    /// panicked on.
    #[test]
    fn valid_magic_then_garbage_header_is_malformed() {
        let mut bytes = vec![0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
        bytes.extend(std::iter::repeat_n(0xFFu8, 512 - 8));
        assert!(matches!(
            open_compound_file(&bytes),
            Err(EmailError::Malformed)
        ));
    }

    /// An absurd declared stream length in a directory entry must not become an
    /// allocation sized by that number, nor a panic — the read is bounded by the
    /// real chain, and an over-long declaration simply fails the read as `Err`.
    /// Here we corrupt the directory sector's stream-length field of a real file
    /// to `u64::MAX` and confirm the container still either opens-and-bounds or
    /// cleanly rejects, without aborting.
    #[test]
    fn an_absurd_declared_stream_length_does_not_panic() {
        let bytes = valid_compound_file(&[("/payload", &[7u8; 200])]);
        // Sweep the whole file writing 0xFF over each 8-byte window that could be
        // read as a length; opening (and walking, when it opens) must never panic.
        for offset in (512..bytes.len().saturating_sub(8)).step_by(8) {
            let mut corrupt = bytes.clone();
            for byte in &mut corrupt[offset..offset + 8] {
                *byte = 0xFF;
            }
            if let Ok(mut compound) = open_compound_file(&corrupt) {
                let paths: Vec<_> = compound
                    .walk()
                    .filter(|entry| entry.is_stream())
                    .map(|entry| entry.path().to_path_buf())
                    .collect();
                for path in paths {
                    // A bounded read: cap the copy so even a mis-declared length
                    // cannot pull unbounded bytes, and swallow read errors.
                    let mut sink = Vec::new();
                    if let Ok(stream) = compound.open_stream(&path) {
                        let _ = std::io::copy(&mut stream.take(1 << 20), &mut sink);
                    }
                }
            }
        }
    }

    /// Truncation sweep: every prefix of a valid container must open-or-`Err`,
    /// never panic. This is the single most productive shape for surfacing
    /// off-by-one slice reads in a container parser.
    #[test]
    fn every_truncated_prefix_is_handled_without_panicking() {
        let bytes = valid_compound_file(&[("/a", b"alpha"), ("/b", b"beta")]);
        for len in 0..bytes.len() {
            // The result is unimportant; the requirement is that it returns.
            let _ = open_compound_file(&bytes[..len]);
        }
    }

    /// Bit-flip sweep across the header and directory region: flipping any single
    /// bit must keep open (and a subsequent bounded walk/read) panic-free.
    #[test]
    fn single_bit_flips_across_the_structure_never_panic() {
        let bytes = valid_compound_file(&[("/a", b"alpha"), ("/b", &[0u8; 300])]);
        // The header is the first sector; the directory and FAT follow. Cover the
        // structural region generously without walking the entire payload.
        let region = bytes.len().min(2048);
        for byte_index in 0..region {
            for bit in 0..8u8 {
                let mut corrupt = bytes.clone();
                corrupt[byte_index] ^= 1 << bit;
                if let Ok(mut compound) = open_compound_file(&corrupt) {
                    let paths: Vec<_> = compound
                        .walk()
                        .filter(|entry| entry.is_stream())
                        .map(|entry| entry.path().to_path_buf())
                        .collect();
                    for path in paths {
                        let mut sink = Vec::new();
                        if let Ok(stream) = compound.open_stream(&path) {
                            let _ = std::io::copy(&mut stream.take(1 << 20), &mut sink);
                        }
                    }
                }
            }
        }
    }
}

/// Programmatic `.msg` construction. `.msg` is a binary compound file, so fixtures are
/// built here in Rust rather than committed as binaries. Test-only: never shipped.
#[cfg(test)]
mod fixtures {
    use super::*;
    use std::io::Write as _;

    /// UTF-16LE encode a string with the trailing NUL terminator Outlook writes.
    pub fn utf16le(text: &str) -> Vec<u8> {
        let mut bytes: Vec<u8> = text
            .encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .collect();
        bytes.extend_from_slice(&[0, 0]);
        bytes
    }

    /// The `__properties_version1.0` stream: a reserved header of `header_size` zero
    /// bytes followed by 16-byte fixed-property records.
    pub struct PropertiesStream {
        header_size: usize,
        records: Vec<u8>,
    }

    impl PropertiesStream {
        pub fn new(header_size: usize) -> Self {
            Self {
                header_size,
                records: Vec::new(),
            }
        }

        pub fn fixed(mut self, id: u16, property_type: u16, value: [u8; 8]) -> Self {
            let tag = ((id as u32) << 16) | (property_type as u32);
            self.records.extend_from_slice(&tag.to_le_bytes());
            self.records.extend_from_slice(&[0u8; 4]); // flags
            self.records.extend_from_slice(&value);
            self
        }

        pub fn int32(self, id: u16, value: i32) -> Self {
            let mut bytes = [0u8; 8];
            bytes[0..4].copy_from_slice(&value.to_le_bytes());
            self.fixed(id, PTYPE_INT32, bytes)
        }

        pub fn build(self) -> Vec<u8> {
            let mut out = vec![0u8; self.header_size];
            out.extend_from_slice(&self.records);
            out
        }
    }

    /// Assemble a compound file from a set of streams. Parent storages are created as
    /// needed, so a caller lists only the streams it wants.
    pub struct MsgBuilder {
        streams: Vec<(String, Vec<u8>)>,
        storages: Vec<String>,
    }

    impl MsgBuilder {
        pub fn new() -> Self {
            Self {
                streams: Vec::new(),
                storages: Vec::new(),
            }
        }

        /// Add a variable-length property stream `__substg1.0_<id><type>` under a
        /// storage path (`""` for the message root).
        pub fn substg(self, storage: &str, id: u16, property_type: u16, content: Vec<u8>) -> Self {
            let path = format!("{storage}/__substg1.0_{id:04X}{property_type:04X}");
            self.stream(&path, content)
        }

        pub fn stream(mut self, path: &str, content: Vec<u8>) -> Self {
            self.streams.push((path.to_owned(), content));
            self
        }

        pub fn build(self) -> Vec<u8> {
            let mut compound = CompoundFile::create(Cursor::new(Vec::new())).unwrap();
            for storage in &self.storages {
                compound.create_storage_all(storage).unwrap();
            }
            for (path, content) in &self.streams {
                if let Some(parent) = Path::new(path).parent() {
                    if parent != Path::new("/") {
                        compound.create_storage_all(parent).unwrap();
                    }
                }
                compound
                    .create_stream(path)
                    .unwrap()
                    .write_all(content)
                    .unwrap();
            }
            compound.flush().unwrap();
            compound.into_inner().into_inner()
        }
    }

    /// A chain of embedded-message containers, `levels` deep, with no other content.
    /// Used to drive the recursion guard.
    pub fn deeply_nested_embedded(levels: usize) -> Vec<u8> {
        let mut compound = CompoundFile::create(Cursor::new(Vec::new())).unwrap();
        let mut path = String::new();
        for _ in 0..levels {
            path.push_str("/__attach_version1.0_#00000000/__substg1.0_3701000D");
        }
        compound.create_storage_all(&path).unwrap();
        compound.flush().unwrap();
        compound.into_inner().into_inner()
    }
}

#[cfg(test)]
mod mapi_tests {
    use super::fixtures::{deeply_nested_embedded, utf16le, MsgBuilder, PropertiesStream};
    use super::*;

    const HEADER_BLOCK: &str = concat!(
        "Message-ID: <header-sourced@example.test>\r\n",
        "From: Alice Attorney <alice@example.test>\r\n",
        "To: Bob Client <bob@example.test>\r\n",
        "Subject: Retainer\r\n",
        "DKIM-Signature: v=1; a=rsa-sha256; d=example.test; s=sel; b=AAAA\r\n",
        "Authentication-Results: mx.example.test; dkim=pass\r\n",
        "Received: from mail.example.test by mx.example.test\r\n",
    );

    /// When the transport header block survived export, the Message-ID is a real
    /// header value and the identifier records that provenance; the DKIM signature and
    /// the rest of the integrity evidence are captured verbatim from the block.
    #[test]
    fn a_header_block_yields_a_header_sourced_identifier_and_integrity() {
        let bytes = MsgBuilder::new()
            .substg(
                "",
                PID_TRANSPORT_MESSAGE_HEADERS,
                PTYPE_UNICODE,
                utf16le(HEADER_BLOCK),
            )
            .substg("", PID_SUBJECT, PTYPE_UNICODE, utf16le("Retainer"))
            .build();

        let message = parse_msg(&bytes).expect("a well-formed .msg parses");

        assert_eq!(
            message.message_identifier,
            MessageIdentifier::FromHeader("header-sourced@example.test".to_owned())
        );
        assert_eq!(message.integrity.dkim_signatures.len(), 1);
        assert!(message.integrity.dkim_signatures[0].contains("d=example.test"));
        assert_eq!(message.integrity.authentication_results.len(), 1);
        assert_eq!(message.integrity.received_chain.len(), 1);
        assert!(!message.raw_headers.is_empty());
        assert_eq!(message.source_format, SourceFormat::Msg);
    }

    /// Outlook frequently drops the header block. With no headers but a
    /// PidTagInternetMessageId, the identifier is recovered from MAPI and tagged as
    /// such. A naive engine that stored a bare `String` would lose this distinction;
    /// this asserts the value is `FromMapi`, never `FromHeader`, and that no
    /// authenticity evidence is invented from a `.msg` that carries none.
    #[test]
    fn a_mapi_identifier_is_never_mistaken_for_a_header_one() {
        let bytes = MsgBuilder::new()
            .substg(
                "",
                PID_INTERNET_MESSAGE_ID,
                PTYPE_UNICODE,
                utf16le("<mapi-synthesized@example.test>"),
            )
            .build();

        let message = parse_msg(&bytes).expect("a headerless .msg still parses");

        assert_eq!(
            message.message_identifier,
            MessageIdentifier::FromMapi("<mapi-synthesized@example.test>".to_owned())
        );
        assert!(!matches!(
            message.message_identifier,
            MessageIdentifier::FromHeader(_)
        ));
        assert_eq!(message.integrity, IntegrityFacts::default());
        assert!(message.raw_headers.is_empty());
    }

    /// A header block present but carrying no Message-ID must not be back-filled from
    /// the MAPI value as if it were header-sourced: the MAPI value wins, tagged MAPI.
    #[test]
    fn a_header_block_without_a_message_id_falls_back_to_the_mapi_value() {
        let header_without_id = "From: Alice <alice@example.test>\r\nSubject: No identifier\r\n";
        let bytes = MsgBuilder::new()
            .substg(
                "",
                PID_TRANSPORT_MESSAGE_HEADERS,
                PTYPE_UNICODE,
                utf16le(header_without_id),
            )
            .substg(
                "",
                PID_INTERNET_MESSAGE_ID,
                PTYPE_UNICODE,
                utf16le("<from-mapi@example.test>"),
            )
            .build();

        let message = parse_msg(&bytes).expect("parses");
        assert_eq!(
            message.message_identifier,
            MessageIdentifier::FromMapi("<from-mapi@example.test>".to_owned())
        );
    }

    /// Neither a header block nor a MAPI identifier: the identifier is `Absent`, not
    /// an empty string masquerading as a value.
    #[test]
    fn no_identifier_source_yields_absent() {
        let bytes = MsgBuilder::new()
            .substg(
                "",
                PID_SUBJECT,
                PTYPE_UNICODE,
                utf16le("No identifier here"),
            )
            .build();

        let message = parse_msg(&bytes).expect("parses");
        assert_eq!(message.message_identifier, MessageIdentifier::Absent);
        assert_eq!(message.subject.as_deref(), Some("No identifier here"));
    }

    /// Subject, sender, delivery time, and bodies are decoded from their property
    /// streams; a remote-content reference in the HTML body is surfaced as a fact.
    #[test]
    fn decodes_envelope_bodies_and_delivery_time() {
        // FILETIME for 2021-01-01T00:00:00Z.
        let delivery_time: u64 = 132_539_328_000_000_000;
        let bytes = MsgBuilder::new()
            .substg("", PID_SUBJECT, PTYPE_UNICODE, utf16le("Quarterly review"))
            .substg(
                "",
                PID_SENDER_NAME,
                PTYPE_UNICODE,
                utf16le("Alice Attorney"),
            )
            .substg(
                "",
                PID_SENDER_SMTP_ADDRESS,
                PTYPE_UNICODE,
                utf16le("alice@example.test"),
            )
            .substg("", PID_BODY, PTYPE_UNICODE, utf16le("Plain text body."))
            .substg(
                "",
                PID_HTML,
                PTYPE_BINARY,
                b"<html><img src=\"https://tracker.example/pixel.gif\"></html>".to_vec(),
            )
            .stream(
                "/__properties_version1.0",
                PropertiesStream::new(HEADER_TOP_LEVEL)
                    .fixed(
                        PID_MESSAGE_DELIVERY_TIME,
                        PTYPE_FILETIME,
                        delivery_time.to_le_bytes(),
                    )
                    .build(),
            )
            .build();

        let message = parse_msg(&bytes).expect("parses");
        assert_eq!(message.subject.as_deref(), Some("Quarterly review"));
        assert_eq!(message.from.len(), 1);
        assert_eq!(
            message.from[0].display_name.as_deref(),
            Some("Alice Attorney")
        );
        assert_eq!(
            message.from[0].address.as_deref(),
            Some("alice@example.test")
        );
        assert_eq!(message.text_bodies, vec!["Plain text body.".to_owned()]);
        assert_eq!(message.html_bodies.len(), 1);
        assert!(message.references_remote_content);
        assert_eq!(message.date_raw.as_deref(), Some("2021-01-01T00:00:00Z"));
        // The RTF body is not decoded; a .msg with only an RTF body has no body text.
        assert_eq!(message.rtf_body, None);
    }

    /// Recipients are routed to To/Cc/Bcc by their recipient-type property.
    #[test]
    fn routes_recipients_by_type() {
        let recip = "/__recip_version1.0_#00000000";
        let bytes = MsgBuilder::new()
            .substg(
                recip,
                PID_RECIPIENT_DISPLAY_NAME,
                PTYPE_UNICODE,
                utf16le("Carol Counsel"),
            )
            .substg(
                recip,
                PID_RECIPIENT_SMTP_ADDRESS,
                PTYPE_UNICODE,
                utf16le("carol@example.test"),
            )
            .stream(
                &format!("{recip}/__properties_version1.0"),
                PropertiesStream::new(HEADER_SUBOBJECT)
                    .int32(PID_RECIPIENT_TYPE, RECIPIENT_TYPE_CC)
                    .build(),
            )
            .build();

        let message = parse_msg(&bytes).expect("parses");
        assert!(message.to.is_empty());
        assert_eq!(message.cc.len(), 1);
        assert_eq!(message.cc[0].address.as_deref(), Some("carol@example.test"));
    }

    /// Each attachment becomes a descriptor located by its MAPI storage — never an
    /// input range — with size from the real stream length; a content-identifier makes
    /// it inline, its absence an attachment.
    #[test]
    fn describes_attachments_by_storage_never_by_input_range() {
        let plain = "/__attach_version1.0_#00000000";
        let inline = "/__attach_version1.0_#00000001";
        let bytes = MsgBuilder::new()
            .substg(
                plain,
                PID_ATTACH_LONG_FILENAME,
                PTYPE_UNICODE,
                utf16le("engagement-letter.pdf"),
            )
            .substg(
                plain,
                PID_ATTACH_MIME_TAG,
                PTYPE_UNICODE,
                utf16le("application/pdf"),
            )
            .substg(plain, PID_ATTACH_DATA, PTYPE_BINARY, vec![0u8; 100])
            .substg(
                inline,
                PID_ATTACH_CONTENT_ID,
                PTYPE_UNICODE,
                utf16le("logo@example.test"),
            )
            .substg(
                inline,
                PID_ATTACH_MIME_TAG,
                PTYPE_UNICODE,
                utf16le("image/png"),
            )
            .substg(inline, PID_ATTACH_DATA, PTYPE_BINARY, vec![0u8; 50])
            .build();

        let message = parse_msg(&bytes).expect("parses");
        assert_eq!(message.parts.len(), 2);

        let letter = message
            .parts
            .iter()
            .find(|part| part.filename.as_deref() == Some("engagement-letter.pdf"))
            .expect("the attachment part is present");
        assert_eq!(letter.media_type.as_deref(), Some("application/pdf"));
        assert_eq!(letter.disposition, Disposition::Attachment);
        assert_eq!(letter.size, 100);
        assert!(!letter.is_embedded_message);
        assert!(matches!(&letter.locator, PartLocator::MapiStream { .. }));
        assert!(!matches!(&letter.locator, PartLocator::InputRange(_)));

        let logo = message
            .parts
            .iter()
            .find(|part| part.content_identifier.is_some())
            .expect("the inline part is present");
        assert_eq!(logo.disposition, Disposition::Inline);
        assert_eq!(logo.size, 50);
    }

    /// An attachment whose method marks it an embedded message is flagged, and the
    /// nested message is descended (here shallow, well within the depth bound).
    #[test]
    fn flags_and_descends_an_embedded_message() {
        let attach = "/__attach_version1.0_#00000000";
        let embedded = format!("{attach}/__substg1.0_3701000D");
        let bytes = MsgBuilder::new()
            .stream(
                &format!("{attach}/__properties_version1.0"),
                PropertiesStream::new(HEADER_SUBOBJECT)
                    .int32(PID_ATTACH_METHOD, ATTACH_METHOD_EMBEDDED_MESSAGE)
                    .build(),
            )
            // The embedded message carries its own subject property.
            .substg(&embedded, PID_SUBJECT, PTYPE_UNICODE, utf16le("Forwarded"))
            .build();

        let message = parse_msg(&bytes).expect("parses");
        assert_eq!(message.parts.len(), 1);
        assert!(message.parts[0].is_embedded_message);

        // The descriptor's locator names the attachment storage, not a flat data
        // stream (an embedded message has none): extracting it must come away
        // not-found rather than reading the storage as if it were a stream.
        assert_eq!(
            crate::extract_part(&bytes, &message.parts[0]),
            Err(EmailError::PartNotFound)
        );
    }

    /// A pathological embedding chain is refused, not run until the stack aborts the
    /// isolate. Deeper than the shared embedded-message bound yields `LimitExceeded`.
    #[test]
    fn a_deep_embedding_chain_is_refused() {
        let bound = Limits::default().max_embedded_message_depth;
        let bytes = deeply_nested_embedded(bound + 2);
        assert!(matches!(parse_msg(&bytes), Err(EmailError::LimitExceeded)));
    }

    /// A `.msg` attachment's bytes live in a compound-file data stream, not a span of
    /// the input, so `extract_part` must re-open the container and read the named
    /// stream. What comes back is exactly the payload written into the attachment-data
    /// stream — the proof that two-phase extraction spans containers, not just the
    /// `.eml` input-range case.
    #[test]
    fn extracting_a_msg_attachment_reads_its_data_stream_through_the_bounded_reader() {
        let attach = "/__attach_version1.0_#00000000";
        let payload: &[u8] = b"%PDF-1.4 engagement letter payload bytes";
        let bytes = MsgBuilder::new()
            .substg(
                attach,
                PID_ATTACH_LONG_FILENAME,
                PTYPE_UNICODE,
                utf16le("engagement-letter.pdf"),
            )
            .substg(attach, PID_ATTACH_DATA, PTYPE_BINARY, payload.to_vec())
            .build();

        let message = parse_msg(&bytes).expect("parses");
        let part = &message.parts[0];
        assert!(matches!(&part.locator, PartLocator::MapiStream { .. }));
        assert_eq!(part.size, payload.len());

        let extracted = crate::extract_part(&bytes, part).expect("the .msg part extracts");
        assert_eq!(extracted, payload);
    }

    /// A caller can tighten `max_decoded_part_bytes` below a `.msg` attachment's real
    /// stream length; extraction refuses the whole read as `LimitExceeded` rather than
    /// handing back a shorter, silently truncated payload.
    #[test]
    fn a_msg_attachment_over_a_tightened_cap_is_refused_not_truncated() {
        let attach = "/__attach_version1.0_#00000000";
        let payload: &[u8] = b"%PDF-1.4 engagement letter payload bytes";
        let bytes = MsgBuilder::new()
            .substg(
                attach,
                PID_ATTACH_LONG_FILENAME,
                PTYPE_UNICODE,
                utf16le("engagement-letter.pdf"),
            )
            .substg(attach, PID_ATTACH_DATA, PTYPE_BINARY, payload.to_vec())
            .build();

        let message = parse_msg(&bytes).expect("parses");
        let part = &message.parts[0];

        let tight_limits = Limits {
            max_decoded_part_bytes: payload.len() - 1,
            ..Limits::default()
        };
        assert_eq!(
            crate::extract_part_with_limits(&bytes, part, &tight_limits),
            Err(EmailError::LimitExceeded)
        );

        // The default cap (64 MiB) is nowhere near this fixture's size, so the
        // untightened path still extracts the same bytes as before.
        let extracted = crate::extract_part(&bytes, part).expect("the .msg part extracts");
        assert_eq!(extracted, payload);
    }

    /// A descriptor naming a stream that is not in the container (a stale or foreign
    /// locator) is a not-found, never a container-parse leak or a panic.
    #[test]
    fn extracting_a_missing_msg_stream_is_part_not_found() {
        let bytes = MsgBuilder::new()
            .substg("", PID_SUBJECT, PTYPE_UNICODE, utf16le("No attachments"))
            .build();
        let phantom = PartDescriptor {
            filename: None,
            media_type: None,
            content_identifier: None,
            disposition: Disposition::Attachment,
            size: 0,
            locator: PartLocator::MapiStream {
                name: "/__attach_version1.0_#00000000/__substg1.0_37010102".to_owned(),
            },
            is_embedded_message: false,
        };
        assert_eq!(
            crate::extract_part(&bytes, &phantom),
            Err(EmailError::PartNotFound)
        );
    }

    /// An odd-length UTF-16 property is not a whole sequence of 16-bit units. It must
    /// be rejected as malformed, never read past its end or panicked on.
    #[test]
    fn an_odd_length_unicode_property_is_rejected_not_panicked_on() {
        let bytes = MsgBuilder::new()
            // Three bytes: cannot be whole UTF-16LE code units.
            .substg("", PID_SUBJECT, PTYPE_UNICODE, vec![0x41, 0x00, 0x42])
            .build();
        assert!(matches!(parse_msg(&bytes), Err(EmailError::Malformed)));
    }

    /// A structurally corrupt container is a clean error, never a panic. Every
    /// truncated prefix of a real `.msg` must return.
    #[test]
    fn a_corrupt_container_is_an_error_not_a_panic() {
        let bytes = MsgBuilder::new()
            .substg("", PID_SUBJECT, PTYPE_UNICODE, utf16le("Retainer"))
            .build();
        for len in 0..bytes.len() {
            // The result is unimportant; the requirement is that it returns.
            let _ = parse_msg(&bytes[..len]);
        }
        assert!(parse_msg(&bytes[..bytes.len() / 2]).is_err());
    }

    /// A properties stream shorter than its own reserved header, and stream names that
    /// are not valid property tags, must not panic — they are simply ignored.
    #[test]
    fn a_truncated_properties_stream_and_junk_names_are_ignored() {
        let bytes = MsgBuilder::new()
            .substg("", PID_SUBJECT, PTYPE_UNICODE, utf16le("Present"))
            // A properties stream far shorter than the 32-byte top-level header.
            .stream("/__properties_version1.0", vec![0u8; 4])
            // A stream whose name is not a __substg1.0_<8 hex> tag.
            .stream("/not_a_property_stream", vec![1, 2, 3])
            // A substg-shaped name with non-hex characters.
            .stream("/__substg1.0_ZZZZZZZZ", vec![9, 9])
            .build();

        let message = parse_msg(&bytes).expect("parses despite the junk");
        assert_eq!(message.subject.as_deref(), Some("Present"));
        assert_eq!(message.date_raw, None);
    }

    /// A `__substg1.0_` stream name whose eight-byte suffix contains a three-byte
    /// character straddling the halfway byte offset (`AAA` + `€` + `AA` is eight
    /// bytes, with `€` occupying bytes 3..6) must be ignored as junk, not panicked
    /// on when the property splitter tries to slice at byte offset 4.
    #[test]
    fn a_substg_name_with_a_multibyte_character_is_rejected_not_panicked_on() {
        let bytes = MsgBuilder::new()
            .substg("", PID_SUBJECT, PTYPE_UNICODE, utf16le("Present"))
            .stream("/__substg1.0_AAA\u{20AC}AA", vec![0x41, 0x00])
            .build();

        let message = parse_msg(&bytes).expect("the multibyte junk name is ignored");
        assert_eq!(message.subject.as_deref(), Some("Present"));
    }

    /// A two-byte character also straddling the same halfway byte offset (`AAA`,
    /// then `é`, then `AAA` is eight bytes, with `é` occupying bytes 3..5) must be
    /// rejected the same way — the boundary hazard is not specific to three-byte
    /// characters.
    #[test]
    fn a_substg_name_with_a_two_byte_character_straddling_the_split_is_rejected_not_panicked_on() {
        let bytes = MsgBuilder::new()
            .substg("", PID_SUBJECT, PTYPE_UNICODE, utf16le("Present"))
            .stream("/__substg1.0_AAA\u{00E9}AAA", vec![0x41, 0x00])
            .build();

        let message = parse_msg(&bytes).expect("the multibyte junk name is ignored");
        assert_eq!(message.subject.as_deref(), Some("Present"));
    }

    /// The same multibyte-name hazard, reached through a recipient storage's child
    /// streams rather than the message root, proving the fix covers every call site
    /// `substreams_of` is used from, not just the top level.
    #[test]
    fn a_multibyte_substg_name_inside_a_recipient_storage_is_rejected_not_panicked_on() {
        let recip = "/__recip_version1.0_#00000000";
        let bytes = MsgBuilder::new()
            .substg(
                recip,
                PID_RECIPIENT_SMTP_ADDRESS,
                PTYPE_UNICODE,
                utf16le("carol@example.test"),
            )
            .stream(
                &format!("{recip}/__substg1.0_AAA\u{20AC}AA"),
                vec![0x41, 0x00],
            )
            .build();

        let message = parse_msg(&bytes).expect("the multibyte junk name is ignored");
        assert_eq!(message.to[0].address.as_deref(), Some("carol@example.test"));
    }

    /// The same hazard again, this time inside an attachment storage's child
    /// streams — attachments walk the same `substreams_of` path as recipients and
    /// the message root, and each call site must be equally panic-safe.
    #[test]
    fn a_multibyte_substg_name_inside_an_attachment_storage_is_rejected_not_panicked_on() {
        let attach = "/__attach_version1.0_#00000000";
        let bytes = MsgBuilder::new()
            .substg(
                attach,
                PID_ATTACH_LONG_FILENAME,
                PTYPE_UNICODE,
                utf16le("engagement-letter.pdf"),
            )
            .stream(
                &format!("{attach}/__substg1.0_AAA\u{20AC}AA"),
                vec![0x41, 0x00],
            )
            .build();

        let message = parse_msg(&bytes).expect("the multibyte junk name is ignored");
        assert_eq!(
            message.parts[0].filename.as_deref(),
            Some("engagement-letter.pdf")
        );
    }

    #[test]
    fn filetime_decodes_a_known_instant() {
        // 2021-01-01T00:00:00Z in FILETIME ticks.
        let ticks: u64 = 132_539_328_000_000_000;
        assert_eq!(
            filetime_to_iso(ticks.to_le_bytes()).as_deref(),
            Some("2021-01-01T00:00:00Z")
        );
        // A zero FILETIME is an unset time, not the 1601 epoch.
        assert_eq!(filetime_to_iso([0u8; 8]), None);
    }

    /// A `.msg` with more attachment storages than `max_part_count` allows must be
    /// refused as `LimitExceeded` — the same shape the `.eml` lane already refuses
    /// for a `multipart/mixed` carrying more children than the cap.
    ///
    /// This proves a real regression, not a hypothetical one: before the breadth cap
    /// this test exercises, `read_attachments` pushed one `PartDescriptor` per
    /// matching storage with no bound at all. Run against this exact fixture and this
    /// exact tightened `Limits`, the prior code returned `Ok` with `parts.len() == 4`
    /// — this test would fail (wrong `Ok`, not the expected `Err`) against that code.
    #[test]
    fn a_msg_with_more_attachments_than_the_part_cap_is_refused() {
        let mut builder = MsgBuilder::new();
        for index in 0..4u32 {
            let storage = format!("/__attach_version1.0_#{index:08X}");
            builder = builder.substg(
                &storage,
                PID_ATTACH_LONG_FILENAME,
                PTYPE_UNICODE,
                utf16le(&format!("attachment-{index}.pdf")),
            );
        }
        let bytes = builder.build();

        let tight_limits = Limits {
            max_part_count: 3,
            ..Limits::default()
        };
        assert_eq!(
            parse_msg_with_limits(&bytes, &tight_limits),
            Err(EmailError::LimitExceeded)
        );
    }

    /// The same breadth cap, exercised across embedded-message recursion: an
    /// embedded `.msg` attachment's own attachments must add to the same running
    /// total as the top-level ones, not reset the count back to zero. Two attachments
    /// at the top level plus two more inside an embedded message is four total parts
    /// (the embedding itself is also a part) against a cap of three.
    #[test]
    fn attachment_counts_accumulate_across_embedded_message_recursion() {
        let attach0 = "/__attach_version1.0_#00000000";
        let attach1 = "/__attach_version1.0_#00000001";
        let embedded = format!("{attach1}/__substg1.0_3701000D");
        let nested_attach = format!("{embedded}/__attach_version1.0_#00000000");

        let bytes = MsgBuilder::new()
            .substg(
                attach0,
                PID_ATTACH_LONG_FILENAME,
                PTYPE_UNICODE,
                utf16le("top-level.pdf"),
            )
            .stream(
                &format!("{attach1}/__properties_version1.0"),
                PropertiesStream::new(HEADER_SUBOBJECT)
                    .int32(PID_ATTACH_METHOD, ATTACH_METHOD_EMBEDDED_MESSAGE)
                    .build(),
            )
            .substg(
                &nested_attach,
                PID_ATTACH_LONG_FILENAME,
                PTYPE_UNICODE,
                utf16le("nested.pdf"),
            )
            .build();

        // Three parts (top-level attachment, the embedded-message attachment itself,
        // and its one nested attachment) fit under a cap of three.
        let fitting_limits = Limits {
            max_part_count: 3,
            ..Limits::default()
        };
        assert!(parse_msg_with_limits(&bytes, &fitting_limits).is_ok());

        // A cap of two cannot fit those same three parts, however they are split
        // across the top level and the embedded message.
        let tight_limits = Limits {
            max_part_count: 2,
            ..Limits::default()
        };
        assert_eq!(
            parse_msg_with_limits(&bytes, &tight_limits),
            Err(EmailError::LimitExceeded)
        );
    }

    /// A `.msg` with more recipient storages than `max_recipient_count` allows must
    /// be refused as `LimitExceeded`.
    ///
    /// Before this bound existed, `read_recipients` pushed one recipient per matching
    /// storage with no bound at all: run against this exact fixture and this exact
    /// tightened `Limits`, the prior code returned `Ok` with `to.len() == 4` — this
    /// test would fail (wrong `Ok`, not the expected `Err`) against that code.
    #[test]
    fn a_msg_with_more_recipients_than_the_recipient_cap_is_refused() {
        let mut builder = MsgBuilder::new();
        for index in 0..4u32 {
            let recip = format!("/__recip_version1.0_#{index:08X}");
            builder = builder.substg(
                &recip,
                PID_RECIPIENT_SMTP_ADDRESS,
                PTYPE_UNICODE,
                utf16le(&format!("recipient-{index}@example.test")),
            );
        }
        let bytes = builder.build();

        let tight_limits = Limits {
            max_recipient_count: 3,
            ..Limits::default()
        };
        assert_eq!(
            parse_msg_with_limits(&bytes, &tight_limits),
            Err(EmailError::LimitExceeded)
        );
    }

    /// A normal, small `.msg` well under every default cap still parses unchanged:
    /// the breadth caps introduced above must not disturb the ordinary path a real
    /// message takes.
    #[test]
    fn a_small_msg_under_default_limits_still_parses_unchanged() {
        let attach = "/__attach_version1.0_#00000000";
        let recip = "/__recip_version1.0_#00000000";
        let bytes = MsgBuilder::new()
            .substg("", PID_SUBJECT, PTYPE_UNICODE, utf16le("Retainer"))
            .substg(
                attach,
                PID_ATTACH_LONG_FILENAME,
                PTYPE_UNICODE,
                utf16le("engagement-letter.pdf"),
            )
            .substg(
                recip,
                PID_RECIPIENT_SMTP_ADDRESS,
                PTYPE_UNICODE,
                utf16le("bob@example.test"),
            )
            .build();

        let message = parse_msg(&bytes).expect("a well-formed .msg still parses");
        assert_eq!(message.subject.as_deref(), Some("Retainer"));
        assert_eq!(message.parts.len(), 1);
        assert_eq!(message.to.len(), 1);
    }
}
