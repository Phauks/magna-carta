//! discovery-core: the pure, I/O-free engine behind discovery ingest. Bytes in, facts out.
//!
//! It identifies a document from its bytes, reads its text natively, normalizes that text into the
//! one canonical form everything derived is derived from, chunks it into passages, digests it five
//! ways, fingerprints it for near-duplicate work, and enumerates or expands an archive under hard
//! guards. It does not store anything, fetch anything, decide anything about a matter, or know what
//! a review set is.
//!
//! WHY IT IS ONE CRATE COMPILED TWO WAYS. The same engine builds native (for the discovery Container
//! and the desktop client) and `wasm32` (for the Worker and the browser). Identical behaviour across
//! the two is not a nicety here: the extracted text feeds a hash and an index, so a desktop that
//! extracted differently from the server would build an index that disagrees with the server's about
//! what a document says, and two fingerprints of one document that do not match are a deduplication
//! that silently stopped working.
//!
//! WHY EVERY LINE OF IT IS MEMORY-SAFE. This engine's entire input is files chosen by the party on
//! the other side of a case, and its entire output feeds material under privilege. That is the worst
//! case the memory-safety rule exists for, not an edge case, so every decoder here is pure Rust and
//! every codec backend is declared explicitly rather than inherited — asserted by
//! [`tests::manifest_declares_only_pure_rust_backends`], which reads this crate's own manifest.
//! Recognition and legacy-binary conversion stay in their existing containers, where the one
//! consented C++ engine is already contained; nothing in this crate reaches them.

pub mod archive;
pub mod charset;
pub mod chunk;
// The committed cross-target vectors. Test-only, and deliberately compiled on BOTH targets: the
// native half runs under `cargo test` and the wasm half under `wasm-pack test`, against the same
// fixed answers.
#[cfg(test)]
mod determinism;
pub mod digest;
pub mod error;
pub mod extract;
pub mod fingerprint;
pub mod identify;
pub mod limits;
pub mod normalize;
pub mod xml;

#[cfg(test)]
pub(crate) mod test_support;

pub use archive::{
    enumerate, expand, ArchiveEntry, ExpandedEntry, Expansion, SkipReason, SkippedEntry,
};
pub use chunk::{document_text, passages_from_pages, Page, Passage};
pub use digest::{digest_all, DigestSet, RunningDigest};
pub use error::{DiscoveryError, DISCOVERY_ERROR_CODES};
pub use extract::{
    extract, extract_with_limits, DateSource, DocumentDate, ExtractedDocument, ExtractionOutcome,
};
pub use fingerprint::{hamming_distance, text_fingerprint};
pub use identify::{
    identify, identify_with_limits, name_agreement, Confidence, Identification, IdentifiedFormat,
    NameAgreement,
};
pub use limits::Limits;
pub use normalize::{normalize, normalize_lines};

/// The engine's own version, recorded in a load manifest beside the text it produced, so a
/// re-processing years later can state exactly what changed. Sourced from the crate manifest rather
/// than restated, because a version that has to be updated in two places is a version that will
/// disagree with itself.
pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Read a document end to end: identify it, extract its text, chunk it into passages, and
/// fingerprint the result. The one call the container host and the wasm edge both stand on, so the
/// order of the stages is fixed HERE and cannot drift between the two.
pub fn read_document(bytes: &[u8], limits: &Limits) -> Result<DocumentReading, DiscoveryError> {
    let identification = identify_with_limits(bytes, limits);
    let outcome = extract_with_limits(bytes, limits)?;
    let document = match outcome {
        ExtractionOutcome::Extracted(document) => document,
        ExtractionOutcome::NeedsConversion { format } => {
            return Ok(DocumentReading::NeedsConversion {
                identification,
                format,
            })
        }
        ExtractionOutcome::NeedsExpansion { format } => {
            return Ok(DocumentReading::NeedsExpansion {
                identification,
                format,
            })
        }
    };
    let passages = passages_from_pages(&document.pages);
    let text = document_text(&passages);
    // A document that yields no text is NOT reported as an empty success. An empty index entry
    // asserts "this document contains no words", which is the one answer a discovery search must
    // never give wrongly — so it is a named exception the report can carry instead.
    if passages.is_empty() && document.pages_needing_recognition.is_empty() {
        return Err(DiscoveryError::NoTextExtracted);
    }
    let fingerprint = fingerprint::text_fingerprint_with_limits(&text, limits);
    Ok(DocumentReading::Read(Box::new(DocumentRead {
        identification,
        document,
        passages,
        fingerprint,
        digests: digest_all(bytes),
    })))
}

/// Everything one pass over a document produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocumentReading {
    /// Boxed because a read carries a whole document's worth of facts while the other two variants
    /// carry a format and a confidence: leaving it inline would make every value of this type as
    /// large as its largest variant, on a type returned once per document at production volumes.
    Read(Box<DocumentRead>),
    /// A legacy binary that reaches its text through the conversion engine.
    NeedsConversion {
        identification: Identification,
        format: IdentifiedFormat,
    },
    /// An archive whose entries are the documents.
    NeedsExpansion {
        identification: Identification,
        format: IdentifiedFormat,
    },
}

/// Everything a successful read produced about one document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentRead {
    pub identification: Identification,
    pub document: ExtractedDocument,
    pub passages: Vec<Passage>,
    /// The near-duplicate signature over the normalized text. Compared with [`hamming_distance`];
    /// the clustering that consumes it is 5·2's.
    pub fingerprint: u64,
    pub digests: DigestSet,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Golden rule 14, enforced on the manifest rather than on review. Reading this crate's own
    /// `Cargo.toml` at COMPILE time (never from a file system, which this crate does not touch)
    /// means a C-backed feature cannot be selected without a test failing — including by a
    /// well-meant future edit that turns a default back on.
    #[test]
    fn manifest_declares_only_pure_rust_backends() {
        const RAW: &str = include_str!("../Cargo.toml");
        // Comments are prose about why the backends are what they are, and that prose necessarily
        // NAMES the backends it rules out. Only the declarations themselves are scanned.
        let manifest: String = RAW
            .lines()
            .filter(|line| !line.trim_start().starts_with('#'))
            .collect::<Vec<&str>>()
            .join("\n");
        // Cargo FEATURES that select a C library, matched quoted so the check reads a feature list
        // and not a word inside a crate name (`asm` is a substring of `wasm-bindgen`).
        const C_BACKED_FEATURES: &[&str] = &[
            "deflate-zlib",
            "deflate-zlib-ng",
            "zlib",
            "zlib-ng",
            "zlib-rs",
            "bzip2",
            "zstd",
            "lzma",
            "native-tls",
            "asm",
            "asm-aarch64",
            "force-soft",
        ];
        for banned in C_BACKED_FEATURES {
            assert!(
                !manifest.contains(&format!("\"{banned}\"")),
                "the manifest selects the {banned} feature, which is a C-backed backend"
            );
        }
        // CRATES that are, or bind, a C library. Matched as a dependency declaration, which is the
        // only way one could enter this crate's own tree directly.
        const C_BACKED_CRATES: &[&str] = &[
            "libz-sys",
            "bzip2-sys",
            "zstd-sys",
            "openssl",
            "openssl-sys",
            "libmagic",
            "poppler",
            "onig_sys",
        ];
        for banned in C_BACKED_CRATES {
            assert!(
                !manifest
                    .lines()
                    .any(|line| line.trim_start().starts_with(&format!("{banned} ="))),
                "the manifest depends on {banned}, which is a C library"
            );
        }
        // And the two backends that MUST be named, rather than left to feature unification to pick.
        assert!(
            manifest.contains(r#"features = ["deflate-flate2"]"#),
            "the archive reader must name its pure-Rust deflate backend"
        );
        assert!(
            manifest.contains(r#"features = ["rust_backend"]"#),
            "the deflate implementation must name miniz_oxide explicitly"
        );
    }

    /// The engine's whole job in one call, over one document, asserted end to end.
    #[test]
    fn reading_a_document_identifies_extracts_chunks_digests_and_fingerprints_it() {
        let bytes = b"The seller shall indemnify the buyer.\nEnvironmental liability follows.\n";
        let reading = read_document(bytes, &Limits::default()).unwrap();
        let DocumentReading::Read(read) = reading else {
            panic!("expected a reading");
        };
        assert_eq!(read.identification.format, IdentifiedFormat::PlainText);
        assert_eq!(read.passages.len(), 1);
        assert!(read.passages[0].text.contains("indemnify"));
        assert_eq!(read.digests.size_bytes, bytes.len() as u64);
        assert_ne!(read.fingerprint, 0);
    }

    #[test]
    fn a_document_that_yields_no_text_is_excepted_rather_than_indexed_empty() {
        // Whitespace only: a real document, read successfully, containing no words. Indexing it as
        // empty would assert that it contains none, which is a different and much worse claim than
        // "we could not get text out of this".
        assert_eq!(
            read_document(b"   \n\t\n   \n", &Limits::default()),
            Err(DiscoveryError::NoTextExtracted)
        );
    }

    #[test]
    fn identical_bytes_read_twice_produce_identical_derived_values() {
        // Everything downstream — the split, the dedup group, the near-duplicate cluster — assumes
        // this. It is asserted rather than assumed because a single non-deterministic step anywhere
        // in the pipeline would surface as a corpus that reclusters itself on re-processing.
        let bytes = test_support::office_open_xml_document("The witness stated plainly.");
        let first = read_document(&bytes, &Limits::default()).unwrap();
        let second = read_document(&bytes, &Limits::default()).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn the_engine_version_is_the_one_the_manifest_declares() {
        assert_eq!(ENGINE_VERSION, env!("CARGO_PKG_VERSION"));
    }
}

/// The hostile-input sweep: every fixture, damaged every way a production damages files, through
/// every entry point.
///
/// This is not a search for the right answer — a mangled file has no right answer. It is a search
/// for the WRONG KIND of wrongness: a panic, a hang, or an allocation sized from a number the file
/// declared. The target this engine compiles to cannot unwind, so a panic on a crafted document is
/// not a caught error, it is an aborted isolate; and the whole pipeline's premise is that a bad
/// document becomes a named exception rather than an incident.
///
/// Deterministic rather than random: the same mutations run on every machine and in every future
/// run, so a failure is reproducible from the test alone. The broader randomized sweep belongs with
/// the same `cargo fuzz` harness the email engine already carries.
#[cfg(test)]
mod hostile_input {
    use super::*;
    use crate::test_support::{
        legacy_word_compound_file, nested_zip_archive, office_open_xml_document,
        office_open_xml_presentation, office_open_xml_workbook, open_document_text,
        outlook_message, zip_from,
    };

    fn corpus() -> Vec<Vec<u8>> {
        vec![
            office_open_xml_document("The seller shall indemnify the buyer."),
            office_open_xml_workbook(),
            office_open_xml_presentation(),
            open_document_text("Deposition of the witness."),
            legacy_word_compound_file(),
            outlook_message(),
            zip_from(&[("a.txt", b"one"), ("b/c.txt", b"two")]),
            nested_zip_archive(2),
            br"{\rtf1\ansi The witness stated\par plainly.}".to_vec(),
            b"From: a@example.test\r\nSubject: s\r\nDate: Tue, 4 Aug 2026 09:30:00 -0700\r\n\r\nbody"
                .to_vec(),
            b"Ordinary prose about the deposition, at some length.".to_vec(),
            include_bytes!("../../pdf-core/tests/fixtures/born_digital.pdf").to_vec(),
            include_bytes!("../../pdf-core/tests/fixtures/hello.pdf").to_vec(),
        ]
    }

    /// Every prefix of a file, at a coarse stride: the shape of a transfer that dropped, which is
    /// how a real production arrives damaged more often than by any other means.
    fn truncations(bytes: &[u8]) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        for divisor in [1usize, 2, 3, 4, 8, 16, 64] {
            out.push(bytes[..bytes.len() / divisor].to_vec());
        }
        out
    }

    /// A byte flipped at a fixed set of positions: the shape of storage rot and of a header
    /// deliberately edited to lie about what follows it.
    fn bit_flips(bytes: &[u8]) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        for position in [0usize, 1, 3, 7, 15, 30, 63, 127, 511] {
            if position >= bytes.len() {
                continue;
            }
            let mut mutated = bytes.to_vec();
            mutated[position] ^= 0xFF;
            out.push(mutated);
        }
        out
    }

    /// Every length field in the file replaced with an absurd one: the declared-length attack, which
    /// is the single most common way a parser is talked into an enormous allocation.
    fn absurd_declared_lengths(bytes: &[u8]) -> Vec<Vec<u8>> {
        let mut mutated = bytes.to_vec();
        for chunk in mutated.chunks_mut(4) {
            if chunk.len() == 4 {
                let value = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                // Only plausible length fields are inflated — a small non-zero number — so the file
                // keeps its shape and lies only about its sizes.
                if (1..=0xFFFF).contains(&value) {
                    chunk.copy_from_slice(&u32::MAX.to_le_bytes());
                }
            }
        }
        vec![mutated]
    }

    #[test]
    fn no_mutation_of_any_fixture_panics_hangs_or_allocates_unbounded() {
        // A tightened budget so an allocation sized from a declared length would be refused loudly
        // rather than absorbed by a generous default.
        let limits = Limits {
            max_extracted_text_bytes: 4 * 1024 * 1024,
            max_expanded_bytes: 16 * 1024 * 1024,
            max_entry_bytes: 8 * 1024 * 1024,
            ..Limits::default()
        };
        let mut examined = 0usize;
        for original in corpus() {
            let mut mutations = truncations(&original);
            mutations.extend(bit_flips(&original));
            mutations.extend(absurd_declared_lengths(&original));
            for mutation in mutations {
                examined += 1;
                // Every entry point, because a fault in one is not a fault in another: the whole
                // point of the exercise is that no route into the engine can be made to fail badly.
                let _ = identify_with_limits(&mutation, &limits);
                let _ = extract_with_limits(&mutation, &limits);
                let _ = read_document(&mutation, &limits);
                let _ = archive::enumerate(&mutation, &limits);
                let _ = archive::expand(&mutation, &limits);
                let _ = digest_all(&mutation);
            }
        }
        // The sweep is only evidence if it actually swept: a corpus that silently became empty
        // would otherwise pass this test by doing nothing.
        assert!(examined > 150, "the sweep examined only {examined} inputs");
    }

    #[test]
    fn a_declared_length_never_sizes_an_allocation() {
        // An archive entry that CLAIMS four gigabytes and holds four bytes. The claim is refused
        // against the ceiling, and what is actually read is bounded by the ceiling and not by the
        // claim — so the honest small entry costs nothing and the lying one costs nothing either.
        let mut archive = zip_from(&[("liar.bin", b"tiny")]);
        // The local header's uncompressed-size field, at a fixed offset by the format's definition.
        archive[22..26].copy_from_slice(&u32::MAX.to_le_bytes());
        let limits = Limits {
            max_entry_bytes: 1024,
            ..Limits::default()
        };
        let outcome = archive::expand(&archive, &limits);
        assert!(outcome.is_ok() || outcome == Err(DiscoveryError::Corrupt));
    }
}

// The wasm-edge module carries the `#[wasm_bindgen]` exports. Gated to target_arch = "wasm32" so it
// never compiles into the native build or its tests. Declaring it turns its exports into real cdylib
// codegen roots, which roots the whole engine through the export graph rather than only through the
// rlib half of the crate — otherwise monomorphization is lazy and a green wasm build would prove
// that the marshalling compiled, not that the engine did.
#[cfg(target_arch = "wasm32")]
mod wasm;
