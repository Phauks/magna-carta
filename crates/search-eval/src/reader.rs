//! A [`RangeReader`] that serves a split from memory and counts what a query pulled through it.
//!
//! In production the reader is an HTTP range GET against the split's object in per-firm R2, so every
//! read this counter records is one network round trip that a query would pay for and that a warm
//! Container's cache would try to avoid. That makes the COUNT the more durable of the two numbers here:
//! milliseconds measured against memory do not transfer to a deployment, but "this query needed 41
//! separate ranged reads totalling 190 KiB" describes work the deployed system must also do, and it is
//! the figure that decides whether a query is one round trip or forty.

use std::io;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use search_core::RangeReader;

/// What one query pulled through a reader.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ReadTally {
    /// Number of separate ranged reads. Each one is an R2 range GET in a deployment.
    pub reads: usize,
    /// Total bytes served across those reads.
    pub bytes: usize,
}

/// An in-memory split served through the [`RangeReader`] seam, tallying every read.
#[derive(Debug)]
pub struct CountingReader {
    split: Vec<u8>,
    reads: AtomicUsize,
    bytes: AtomicUsize,
}

impl CountingReader {
    pub fn new(split: Vec<u8>) -> Arc<Self> {
        Arc::new(Self {
            split,
            reads: AtomicUsize::new(0),
            bytes: AtomicUsize::new(0),
        })
    }

    /// Reset the tally, so the next operation is measured on its own.
    pub fn reset(&self) {
        self.reads.store(0, Ordering::Relaxed);
        self.bytes.store(0, Ordering::Relaxed);
    }

    pub fn tally(&self) -> ReadTally {
        ReadTally {
            reads: self.reads.load(Ordering::Relaxed),
            bytes: self.bytes.load(Ordering::Relaxed),
        }
    }
}

impl RangeReader for CountingReader {
    fn read_range(&self, offset: usize, length: usize) -> io::Result<Vec<u8>> {
        let end = offset
            .checked_add(length)
            .filter(|end| *end <= self.split.len())
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::UnexpectedEof, "range past end of split")
            })?;
        self.reads.fetch_add(1, Ordering::Relaxed);
        self.bytes.fetch_add(length, Ordering::Relaxed);
        Ok(self.split[offset..end].to_vec())
    }

    fn total_len(&self) -> usize {
        self.split.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reader_tallies_reads_and_bytes_and_resets() {
        let reader = CountingReader::new(vec![7u8; 1000]);
        reader.read_range(0, 10).unwrap();
        reader.read_range(100, 40).unwrap();
        assert_eq!(
            reader.tally(),
            ReadTally {
                reads: 2,
                bytes: 50
            }
        );
        reader.reset();
        assert_eq!(reader.tally(), ReadTally::default());
    }

    #[test]
    fn a_range_past_the_end_errors_rather_than_panicking() {
        let reader = CountingReader::new(vec![0u8; 16]);
        assert!(reader.read_range(8, 100).is_err());
        assert!(reader.read_range(usize::MAX, 1).is_err());
    }
}
