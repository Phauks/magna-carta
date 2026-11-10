//! The **split**: a Tantivy index packaged as one self-contained, immutable blob.
//!
//! A split is how the keyword index leaves the machine that built it. Tantivy normally writes an index
//! as a directory of files on local disk; a split bundles those files into a single byte string with a
//! **footer** — a table of `{name, offset, len}` plus the document count and schema generation — so the
//! whole index can be `put` to per-firm R2 under one key and enumerated without listing the bucket.
//!
//! Splits are written **once** and never mutated: new documents make new splits, and housekeeping
//! merges small splits into larger ones (the design's compaction). Immutability is what lets a query
//! read an old split safely while a newer one is being published.
//!
//! This slice proves the split *format* and the build -> split -> open round trip. It reconstructs the
//! index into an in-memory directory to query it; the later slice replaces that with a directory that
//! serves Tantivy's reads as **HTTP ranged reads against R2** off the footer's offsets, so a query
//! fetches only the postings it walks rather than the whole split. The footer's offset table is exactly
//! the map that range-reading directory will index into — the format does not change, only the reader.

use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tantivy::directory::{RamDirectory, TerminatingWrite};
use tantivy::{Directory, Index, TantivyDocument};

use crate::error::SearchError;
use crate::schema::{register_tokenizers, SearchSchema, SCHEMA_GENERATION};

/// One extracted passage on its way into the index. `body` is the searchable text; the two ids are the
/// pointers a hit carries back so the caller can hydrate the passage through the data-access layer.
#[derive(Clone, Debug)]
pub struct IndexDocument {
    pub document_id: String,
    pub chunk_id: String,
    pub body: String,
}

/// One bundled file inside a split, located by a byte range into the split's data region.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub offset: usize,
    pub len: usize,
}

/// The split's self-description, read first at query time. It answers "what is in this split, and can I
/// open it?" without touching the postings: the schema generation gates compatibility, `document_count`
/// sizes the split for compaction decisions, and `files` locates every index file for a ranged reader.
///
/// The pruning digest the design calls for — a per-field term/range summary that lets a query skip a
/// split whose terms exclude it entirely — is a documented next increment: it belongs here beside
/// `document_count`, read from the footer alone, and does not change the on-disk file layout.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Footer {
    pub schema_generation: u32,
    pub document_count: u64,
    pub files: Vec<FileEntry>,
}

/// The fixed-width trailer at the very end of a split: the footer's length, so a reader seeks
/// `split.len() - 8` to find where the footer begins. Little-endian `u64`.
pub(crate) const TRAILER_LEN: usize = 8;

/// Build an immutable split from a batch of passages.
///
/// The index is built in a temporary on-disk directory (the Container's local scratch in production),
/// committed once so the batch lands as a single segment, then every index file is concatenated with a
/// footer into the returned bytes. Determinism note: Tantivy names segments with a random id, so two
/// builds of the same input are not byte-identical; the split *content* is equivalent (same documents,
/// same postings) and a re-index converges on the same searchable state, which is the property the
/// pipeline's idempotency needs — not byte-equality of the blob.
pub fn build_split(documents: &[IndexDocument]) -> Result<Vec<u8>, SearchError> {
    let scratch = tempfile::tempdir()?;
    let search_schema = SearchSchema::build();
    let index = register_tokenizers(Index::create_in_dir(
        scratch.path(),
        search_schema.schema().clone(),
    )?);

    // ONE indexing thread, deliberately. Tantivy's default writer spawns one worker per core and each
    // worker that receives documents commits a segment of its own, so the same batch lands as two,
    // five, or eight segments depending purely on how the machine scheduled the workers. That is wrong
    // for a split twice over: a query has to consult every segment's term dictionary, which is exactly
    // the per-query I/O the split model exists to avoid, and the resulting split has no stable size or
    // read cost to reason about. Indexing on one thread makes a batch exactly one segment, every time.
    // The cost is single-threaded indexing throughput, which is acceptable because batch size is
    // bounded upstream by the pipeline and the build runs off the request path in a Container.
    //
    // 50 MiB writer heap: enough for a batch-sized segment without spilling (it is the whole budget
    // now that there is one worker to share it), and well under a Container's memory.
    let mut writer = index.writer_with_num_threads(1, 50_000_000)?;
    for document in documents {
        let mut tantivy_document = TantivyDocument::default();
        tantivy_document.add_text(search_schema.document_id(), &document.document_id);
        tantivy_document.add_text(search_schema.chunk_id(), &document.chunk_id);
        tantivy_document.add_text(search_schema.body(), &document.body);
        writer.add_document(tantivy_document)?;
    }
    writer.commit()?;
    // Release the writer (and its lock file) before we read the directory, so the lock is gone and not
    // a candidate for bundling.
    drop(writer);

    bundle_directory(scratch.path(), documents.len() as u64, &|_| true)
}

/// Concatenate every index file under `dir` that `keep` accepts, and append the footer + trailer. Lock
/// files are always excluded — they are writer-local coordination, never part of the queryable index.
///
/// `keep` exists for the merge path. A freshly built index directory holds only live files, but a
/// directory that has been merged and had deletions applied also holds the superseded segments, which
/// nothing will ever read again; bundling them would inflate every split compaction publishes. The merge
/// path passes the file set the index's own metadata declares live, so the decision comes from Tantivy
/// rather than from a guess about naming.
pub(crate) fn bundle_directory(
    dir: &Path,
    document_count: u64,
    keep: &dyn Fn(&str) -> bool,
) -> Result<Vec<u8>, SearchError> {
    let mut data: Vec<u8> = Vec::new();
    let mut files: Vec<FileEntry> = Vec::new();

    // Sort by name so the data region is laid out deterministically given the same set of files. (The
    // segment id inside those names is still random; this only removes directory-iteration-order noise.)
    let mut entries: Vec<_> = std::fs::read_dir(dir)?.collect::<Result<_, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        // `.tantivy-writer.lock` / `.tantivy-meta.lock` — coordination, not index content.
        if name.ends_with(".lock") {
            continue;
        }
        if !keep(&name) {
            continue;
        }
        let bytes = std::fs::read(&path)?;
        let offset = data.len();
        data.extend_from_slice(&bytes);
        files.push(FileEntry {
            name,
            offset,
            len: bytes.len(),
        });
    }

    let footer = Footer {
        schema_generation: SCHEMA_GENERATION,
        document_count,
        files,
    };
    let footer_bytes = serde_json::to_vec(&footer)?;

    let mut split = data;
    split.extend_from_slice(&footer_bytes);
    split.extend_from_slice(&(footer_bytes.len() as u64).to_le_bytes());
    Ok(split)
}

/// Read a split's footer without opening the index — the cheap first read a query does against every
/// candidate split. In production this is a ranged read of the split's tail from R2; here it is a slice.
pub fn read_footer(split: &[u8]) -> Result<Footer, SearchError> {
    if split.len() < TRAILER_LEN {
        return Err(SearchError::MalformedSplit("shorter than the trailer"));
    }
    let trailer_at = split.len() - TRAILER_LEN;
    let footer_len =
        u64::from_le_bytes(split[trailer_at..].try_into().expect("trailer is 8 bytes")) as usize;
    if footer_len > trailer_at {
        return Err(SearchError::MalformedSplit(
            "footer length exceeds the split",
        ));
    }
    let footer_at = trailer_at - footer_len;
    parse_footer(&split[footer_at..trailer_at])
}

/// Parse and validate a footer from its raw JSON bytes. Shared by the whole-slice [`read_footer`] and
/// the ranged reader (which fetches only the tail), so both refuse an incompatible generation the same
/// way rather than opening a split they may misread.
pub(crate) fn parse_footer(footer_bytes: &[u8]) -> Result<Footer, SearchError> {
    parse_footer_at_generation(footer_bytes, SCHEMA_GENERATION)
}

/// Parse a footer and require the generation its reader understands. The split FORMAT is shared with
/// indexes that are not this crate's schema at all (the address index is packaged the same way), and
/// each of those has a generation of its own: a change to how the body of a document is cut into
/// words must not make an address partition unreadable. So the generation a reader requires is the
/// reader's to name.
pub(crate) fn parse_footer_at_generation(
    footer_bytes: &[u8],
    generation: u32,
) -> Result<Footer, SearchError> {
    let footer: Footer = serde_json::from_slice(footer_bytes)?;
    if footer.schema_generation != generation {
        return Err(SearchError::IncompatibleGeneration {
            split: footer.schema_generation,
            reader: generation,
        });
    }
    Ok(footer)
}

/// Reconstruct the index from a split so it can be queried.
///
/// This slice writes every bundled file back into an in-memory directory and opens it — correct and
/// dependency-free, and it proves the footer's offset table addresses the files exactly. The later
/// slice swaps this for a directory that serves Tantivy's reads as ranged reads against the split in
/// R2 (using the same offsets), so a large split is never materialized in full to answer a query.
pub fn open_split(split: &[u8]) -> Result<Index, SearchError> {
    let footer = read_footer(split)?;
    let directory = RamDirectory::create();
    for file in &footer.files {
        let end = file.offset + file.len;
        if end > split.len() {
            return Err(SearchError::MalformedSplit("file range exceeds the split"));
        }
        let mut writer = directory.open_write(Path::new(&file.name))?;
        writer.write_all(&split[file.offset..end])?;
        writer.terminate()?;
    }
    Ok(register_tokenizers(Index::open(directory)?))
}
