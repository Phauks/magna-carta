//! Serving a split's index from a byte-range source, so a query reads only the postings it walks.
//!
//! [`build_split`](crate::build_split) proved the split *format*; this module proves the *access
//! pattern* the format was designed for. Rather than materialize a whole split to query it (what
//! [`query_split`](crate::query_split) does), a [`SplitDirectory`] serves Tantivy's reads straight off
//! the footer's offset table through a [`RangeReader`]: each read Tantivy issues for a term dictionary
//! block, a postings list, or a stored-field block becomes a single ranged read of exactly those bytes.
//!
//! In production the `RangeReader` is an HTTP range GET against the split's object in per-firm R2, so a
//! query over a multi-gigabyte index transfers kilobytes — the whole point of the split model, and why
//! per-query cost tracks the query's selectivity rather than the corpus size. The trait is the seam: the
//! R2 adapter lives in the search Worker; this crate stays pure and is tested with an in-memory reader
//! that counts exactly how many bytes a query pulled.
//!
//! The directory is strictly read-only: splits are immutable, so every write path is refused. Opening
//! and querying an index never writes, so refusing writes cannot break the read path.

use std::collections::HashMap;
use std::fmt;
use std::io;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tantivy::directory::error::{DeleteError, LockError, OpenReadError, OpenWriteError};
use tantivy::directory::{
    DirectoryLock, FileHandle, Lock, OwnedBytes, WatchCallback, WatchHandle, WritePtr,
};
use tantivy::{Directory, HasLen, Index};

use crate::error::SearchError;
use crate::schema::{register_tokenizers, SCHEMA_GENERATION};
use crate::split::{parse_footer_at_generation, FileEntry, TRAILER_LEN};

/// A source that serves arbitrary byte ranges of one split. The production implementation issues HTTP
/// range GETs against the split's object in R2; a test implementation slices an in-memory buffer and can
/// count exactly how many bytes a query pulled. Implementations must return exactly `length` bytes for a
/// valid range, or an error — a short read is a corrupt split, not a partial success.
pub trait RangeReader: Send + Sync + fmt::Debug {
    /// Read `length` bytes starting at `offset` from the split.
    fn read_range(&self, offset: usize, length: usize) -> io::Result<Vec<u8>>;
    /// The total size of the split in bytes, so the footer can be located from the tail.
    fn total_len(&self) -> usize;
}

/// Read a split's footer through a [`RangeReader`], fetching only the tail: the 8-byte trailer, then the
/// footer bytes it points at. This is the cheap first read a query does against a candidate split — no
/// postings touched, just enough to know the split's files and whether it can be opened at all.
pub fn read_footer_ranged(reader: &dyn RangeReader) -> Result<crate::Footer, SearchError> {
    read_footer_ranged_at_generation(reader, SCHEMA_GENERATION)
}

/// [`read_footer_ranged`] for an index that is packaged as a split and is not this crate's schema, so
/// carries a generation of its own.
pub fn read_footer_ranged_at_generation(
    reader: &dyn RangeReader,
    generation: u32,
) -> Result<crate::Footer, SearchError> {
    let total = reader.total_len();
    if total < TRAILER_LEN {
        return Err(SearchError::MalformedSplit("shorter than the trailer"));
    }
    let trailer = reader.read_range(total - TRAILER_LEN, TRAILER_LEN)?;
    let footer_len = u64::from_le_bytes(
        trailer
            .as_slice()
            .try_into()
            .map_err(|_| SearchError::MalformedSplit("short trailer read"))?,
    ) as usize;
    if footer_len > total - TRAILER_LEN {
        return Err(SearchError::MalformedSplit(
            "footer length exceeds the split",
        ));
    }
    let footer_bytes = reader.read_range(total - TRAILER_LEN - footer_len, footer_len)?;
    parse_footer_at_generation(&footer_bytes, generation)
}

/// A read-only Tantivy [`Directory`] backed by a split's footer and a [`RangeReader`]. Every file
/// Tantivy asks for is located in the footer's offset table and served by a ranged read; there is no
/// local copy of the index.
#[derive(Clone)]
pub struct SplitDirectory {
    files: Arc<HashMap<PathBuf, FileEntry>>,
    reader: Arc<dyn RangeReader>,
}

impl fmt::Debug for SplitDirectory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SplitDirectory")
            .field("files", &self.files.len())
            .finish()
    }
}

impl SplitDirectory {
    /// Open a directory over a split by reading its footer through the reader. No postings are read;
    /// the index is not opened here — that is [`open_index`].
    pub fn open(reader: Arc<dyn RangeReader>) -> Result<Self, SearchError> {
        Self::open_at_generation(reader, SCHEMA_GENERATION)
    }

    /// [`SplitDirectory::open`] for an index that is packaged as a split and is not this crate's
    /// schema. Such an index has a generation of its own, which a change to this crate's schema must
    /// not move, so its reader names the generation it understands.
    pub fn open_at_generation(
        reader: Arc<dyn RangeReader>,
        generation: u32,
    ) -> Result<Self, SearchError> {
        let footer = read_footer_ranged_at_generation(reader.as_ref(), generation)?;
        let files = footer
            .files
            .into_iter()
            .map(|entry| (PathBuf::from(&entry.name), entry))
            .collect();
        Ok(Self {
            files: Arc::new(files),
            reader,
        })
    }

    fn entry(&self, path: &Path) -> Result<&FileEntry, OpenReadError> {
        self.files
            .get(path)
            .ok_or_else(|| OpenReadError::FileDoesNotExist(path.to_path_buf()))
    }
}

/// A read-only file inside a split: its byte range and the shared reader. Tantivy reads sub-ranges of it
/// (a term-dictionary block, a postings list); each becomes one ranged read of exactly those bytes.
#[derive(Debug)]
struct SplitFileHandle {
    offset: usize,
    length: usize,
    reader: Arc<dyn RangeReader>,
}

impl HasLen for SplitFileHandle {
    fn len(&self) -> usize {
        self.length
    }
}

impl FileHandle for SplitFileHandle {
    fn read_bytes(&self, range: Range<usize>) -> io::Result<OwnedBytes> {
        if range.end > self.length || range.start > range.end {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "read past the end of a split file",
            ));
        }
        let bytes = self
            .reader
            .read_range(self.offset + range.start, range.end - range.start)?;
        Ok(OwnedBytes::new(bytes))
    }
}

fn read_only() -> io::Error {
    io::Error::new(io::ErrorKind::Unsupported, "a split directory is read-only")
}

impl Directory for SplitDirectory {
    fn get_file_handle(&self, path: &Path) -> Result<Arc<dyn FileHandle>, OpenReadError> {
        let entry = self.entry(path)?;
        Ok(Arc::new(SplitFileHandle {
            offset: entry.offset,
            length: entry.len,
            reader: self.reader.clone(),
        }))
    }

    fn atomic_read(&self, path: &Path) -> Result<Vec<u8>, OpenReadError> {
        let entry = self.entry(path)?;
        self.reader
            .read_range(entry.offset, entry.len)
            .map_err(|io_error| OpenReadError::IoError {
                io_error: Arc::new(io_error),
                filepath: path.to_path_buf(),
            })
    }

    fn exists(&self, path: &Path) -> Result<bool, OpenReadError> {
        Ok(self.files.contains_key(path))
    }

    fn delete(&self, path: &Path) -> Result<(), DeleteError> {
        Err(DeleteError::IoError {
            io_error: Arc::new(read_only()),
            filepath: path.to_path_buf(),
        })
    }

    fn open_write(&self, path: &Path) -> Result<WritePtr, OpenWriteError> {
        Err(OpenWriteError::IoError {
            io_error: Arc::new(read_only()),
            filepath: path.to_path_buf(),
        })
    }

    fn atomic_write(&self, _path: &Path, _data: &[u8]) -> io::Result<()> {
        Err(read_only())
    }

    fn sync_directory(&self) -> io::Result<()> {
        Ok(())
    }

    fn acquire_lock(&self, _lock: &Lock) -> Result<DirectoryLock, LockError> {
        // A split is immutable and read-only: there is no writer to exclude, so locking is a no-op.
        // The default implementation acquires the lock by creating a lock file through `open_write`,
        // which this directory refuses — so it must be overridden, or opening an index for reading
        // fails trying to take the meta lock.
        Ok(DirectoryLock::from(Box::new(())))
    }

    fn watch(&self, _watch_callback: WatchCallback) -> tantivy::Result<WatchHandle> {
        // The split is immutable, so nothing ever changes to notify a watcher about.
        Ok(WatchHandle::empty())
    }
}

/// Open a Tantivy index that reads through the range reader. Opening reads only the split's metadata
/// (`meta.json` and the per-segment file footers), not its postings — those are read lazily, per query,
/// as ranged reads.
pub fn open_index(reader: Arc<dyn RangeReader>) -> Result<Index, SearchError> {
    let directory = SplitDirectory::open(reader)?;
    Ok(register_tokenizers(Index::open(directory)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use crate::{build_split, query_over_reader, query_split, IndexDocument};

    /// A [`RangeReader`] over an in-memory split that counts every byte served, so a test can prove a
    /// query pulled only a fraction of the split rather than the whole thing.
    #[derive(Debug)]
    struct CountingReader {
        data: Vec<u8>,
        bytes_read: Arc<AtomicUsize>,
    }

    impl CountingReader {
        fn new(data: Vec<u8>) -> (Arc<Self>, Arc<AtomicUsize>) {
            let counter = Arc::new(AtomicUsize::new(0));
            (
                Arc::new(Self {
                    data,
                    bytes_read: counter.clone(),
                }),
                counter,
            )
        }
    }

    impl RangeReader for CountingReader {
        fn read_range(&self, offset: usize, length: usize) -> io::Result<Vec<u8>> {
            let end = offset
                .checked_add(length)
                .filter(|end| *end <= self.data.len())
                .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "range past end"))?;
            self.bytes_read.fetch_add(length, Ordering::Relaxed);
            Ok(self.data[offset..end].to_vec())
        }

        fn total_len(&self) -> usize {
            self.data.len()
        }
    }

    fn doc(id: &str, body: &str) -> IndexDocument {
        IndexDocument {
            document_id: id.to_owned(),
            chunk_id: format!("{id}:p1"),
            body: body.to_owned(),
        }
    }

    /// A split big enough that a single-term query reads a small fraction of it: 500 documents of the
    /// same filler plus one carrying a term nothing else does.
    fn large_split() -> Vec<u8> {
        let mut docs: Vec<IndexDocument> = (0..500)
            .map(|i| {
                doc(
                    &format!("doc-{i}"),
                    "the parties agree to the terms and conditions set forth in this agreement",
                )
            })
            .collect();
        docs.push(doc(
            "needle",
            "the escrow indemnification is zzzuniquetoken here",
        ));
        build_split(&docs).unwrap()
    }

    #[test]
    fn a_query_through_the_reader_matches_an_in_memory_query() {
        let split = large_split();
        let (reader, _) = CountingReader::new(split.clone());
        let via_reader = query_over_reader(reader, "zzzuniquetoken", 10).unwrap();
        let via_memory = query_split(&split, "zzzuniquetoken", 10).unwrap();
        assert_eq!(
            via_reader, via_memory,
            "the reader path must match the in-memory path"
        );
        assert_eq!(via_reader.len(), 1);
        assert_eq!(via_reader[0].document_id, "needle");
    }

    #[test]
    fn a_rare_term_query_reads_far_less_than_the_whole_split() {
        let split = large_split();
        let split_len = split.len();
        let (reader, bytes_read) = CountingReader::new(split);
        let hits = query_over_reader(reader, "zzzuniquetoken", 10).unwrap();
        assert_eq!(hits.len(), 1);
        let read = bytes_read.load(Ordering::Relaxed);
        // The whole point of the split model: per-query I/O tracks the query's selectivity, not the
        // corpus size. A rare-term query touches the term dictionary, one short postings list, and one
        // stored-doc block — never the whole split. The fraction shrinks as the corpus grows (the
        // postings and store grow with it while the query still reads only its slice); even at this
        // small scale, where fixed per-segment metadata dominates, it stays around a quarter.
        //
        // Both numbers are exact, not approximate: `build_split` indexes on one thread, so the batch
        // lands as one segment and neither the split's size nor the bytes this query walks depend on
        // how the machine happened to schedule anything (a_batch_lands_as_a_single_segment in lib.rs
        // pins that). A multi-segment split makes both vary run to run — a searcher consults every
        // segment's term dictionary, so the ratio swings with the segment count.
        assert!(
            read < split_len / 2,
            "a rare-term query must read well under half the split; read {read} of {split_len}"
        );
    }

    #[test]
    fn reading_the_footer_touches_only_the_tail() {
        let split = large_split();
        let split_len = split.len();
        let (reader, bytes_read) = CountingReader::new(split);
        let footer = read_footer_ranged(reader.as_ref()).unwrap();
        assert_eq!(footer.document_count, 501);
        let read = bytes_read.load(Ordering::Relaxed);
        assert!(
            read * 10 < split_len,
            "the footer read must be a small tail, not the whole split; read {read} of {split_len}"
        );
    }

    #[test]
    fn a_missing_file_is_reported_not_panicked() {
        let split = large_split();
        let (reader, _) = CountingReader::new(split);
        let directory = SplitDirectory::open(reader).unwrap();
        assert!(!directory.exists(Path::new("nonexistent.idx")).unwrap());
        assert!(directory
            .get_file_handle(Path::new("nonexistent.idx"))
            .is_err());
    }
}
