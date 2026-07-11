//! The record every lane produces. No serde here — marshalling lives at the edges.

/// Which lane produced a record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceFormat {
    Eml,
    Msg,
    MboxMember,
}

/// A message identifier that remembers where it came from.
///
/// A `.msg` file carries RFC 5322 headers only when `PidTagTransportMessageHeaders`
/// survived export, which Outlook frequently drops. An identifier synthesized from
/// MAPI properties is not the same bytes another recipient's `.eml` copy carries, so
/// collapsing both into a `String` would let dedup merge distinct messages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MessageIdentifier {
    FromHeader(String),
    FromMapi(String),
    Absent,
}

impl MessageIdentifier {
    pub fn value(&self) -> Option<&str> {
        match self {
            MessageIdentifier::FromHeader(value) | MessageIdentifier::FromMapi(value) => {
                Some(value)
            }
            MessageIdentifier::Absent => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Address {
    pub display_name: Option<String>,
    pub address: Option<String>,
}

/// How a part presented itself. `Inline` covers `cid:`-referenced images.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Disposition {
    Attachment,
    Inline,
}

/// Where a part's bytes actually live, which differs by container.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PartLocator {
    /// A contiguous slice of the original input buffer. MIME parts in an RFC 5322
    /// message (and in each mbox member) are literally spans of the bytes handed in.
    InputRange(core::ops::Range<usize>),
    /// A named stream inside a compound file. Its bytes are reassembled from
    /// scattered sectors, so no span of the input buffer denotes them.
    MapiStream { name: String },
}

/// A part is described, never materialized, by `parse`. `locator` says where its
/// bytes live; `extract_part` turns one descriptor into bytes on demand.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PartDescriptor {
    pub filename: Option<String>,
    pub media_type: Option<String>,
    pub content_identifier: Option<String>,
    pub disposition: Disposition,
    pub size: usize,
    pub locator: PartLocator,
    pub is_embedded_message: bool,
}

/// Authenticity evidence, captured verbatim with no verdict attached. The engine
/// reports facts; whatever consumes it decides what they mean.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IntegrityFacts {
    pub dkim_signatures: Vec<String>,
    pub authentication_results: Vec<String>,
    pub received_chain: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedMessage {
    pub message_identifier: MessageIdentifier,
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,
    pub subject: Option<String>,
    pub date_raw: Option<String>,
    pub from: Vec<Address>,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub bcc: Vec<Address>,
    /// The full, ordered header list, verbatim. This is the evidentiary artifact and
    /// the signing input an external DKIM verifier requires.
    pub raw_headers: Vec<(String, String)>,
    pub text_bodies: Vec<String>,
    pub html_bodies: Vec<String>,
    /// Present when a `.msg` carries an RTF body and no plain-text alternative.
    /// Decompressed but not converted — conversion belongs to a renderer.
    pub rtf_body: Option<String>,
    pub parts: Vec<PartDescriptor>,
    pub integrity: IntegrityFacts,
    pub source_format: SourceFormat,
    /// Whether a body references remote content. A fact for a future renderer,
    /// not something this engine acts on.
    pub references_remote_content: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_identifier_records_its_origin_not_just_a_string() {
        let from_header = MessageIdentifier::FromHeader("<a@b.example>".to_owned());
        let from_mapi = MessageIdentifier::FromMapi("<a@b.example>".to_owned());

        // Same bytes, different provenance: they must not compare equal, or
        // cross-source dedup would silently merge a synthesized identifier
        // with a real one.
        assert_ne!(from_header, from_mapi);
        assert_eq!(from_header.value(), Some("<a@b.example>"));
        assert_eq!(MessageIdentifier::Absent.value(), None);
    }

    #[test]
    fn a_mapi_stream_locator_exposes_no_input_range() {
        let descriptor = PartDescriptor {
            filename: Some("engagement-letter.pdf".to_owned()),
            media_type: Some("application/pdf".to_owned()),
            content_identifier: None,
            disposition: Disposition::Attachment,
            size: 0,
            locator: PartLocator::MapiStream {
                name: "__substg1.0_37010102".to_owned(),
            },
            is_embedded_message: false,
        };

        // A caller that only knows how to read an `InputRange` must come away
        // with nothing rather than a wrong slice: there is no range to hand it.
        let range = match &descriptor.locator {
            PartLocator::InputRange(range) => Some(range.clone()),
            PartLocator::MapiStream { .. } => None,
        };
        assert_eq!(range, None);
    }
}
