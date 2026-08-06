//! The five-algorithm digest set, computed in one pass over the bytes.
//!
//! The set is not a choice this engine gets to make: eDiscovery load files and opposing-party
//! tooling specify MD5 and SHA-1 to this day, so a manifest that omits them is a manifest the other
//! side cannot ingest. They are carried as LEGACY INTEROP and are not a security claim — the same
//! position, and the same five algorithms in the same field names, as
//! `packages/file-integrity/src/types.ts`, so a digest computed here and one computed there are
//! comparable without a mapping table.
//!
//! One pass matters at discovery volumes: five passes over a production is five reads of every byte
//! for an answer that costs one.

use md5::Md5;
use sha1::Sha1;
use sha2::{Digest, Sha256, Sha384, Sha512};

/// The five digests plus the size they were computed over. Hex is lowercase, matching every other
/// digest the platform records.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DigestSet {
    pub md5: String,
    pub sha1: String,
    pub sha256: String,
    pub sha384: String,
    pub sha512: String,
    pub size_bytes: u64,
}

/// Digest a whole buffer.
pub fn digest_all(bytes: &[u8]) -> DigestSet {
    let mut running = RunningDigest::new();
    running.update(bytes);
    running.finish()
}

/// The same five digests, fed incrementally. A caller streaming an entry out of an archive never has
/// the whole thing in memory at once, and must not have to buffer it just to hash it.
pub struct RunningDigest {
    md5: Md5,
    sha1: Sha1,
    sha256: Sha256,
    sha384: Sha384,
    sha512: Sha512,
    size_bytes: u64,
}

impl RunningDigest {
    pub fn new() -> Self {
        Self {
            md5: Md5::new(),
            sha1: Sha1::new(),
            sha256: Sha256::new(),
            sha384: Sha384::new(),
            sha512: Sha512::new(),
            size_bytes: 0,
        }
    }

    pub fn update(&mut self, chunk: &[u8]) {
        self.md5.update(chunk);
        self.sha1.update(chunk);
        self.sha256.update(chunk);
        self.sha384.update(chunk);
        self.sha512.update(chunk);
        self.size_bytes = self.size_bytes.saturating_add(chunk.len() as u64);
    }

    pub fn finish(self) -> DigestSet {
        DigestSet {
            md5: hex(&self.md5.finalize()),
            sha1: hex(&self.sha1.finalize()),
            sha256: hex(&self.sha256.finalize()),
            sha384: hex(&self.sha384.finalize()),
            sha512: hex(&self.sha512.finalize()),
            size_bytes: self.size_bytes,
        }
    }
}

impl Default for RunningDigest {
    fn default() -> Self {
        Self::new()
    }
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        // Written out rather than formatted: this runs over every byte of every document in a
        // production, and the formatting machinery is the expensive part of a hex encoder.
        const DIGITS: &[u8; 16] = b"0123456789abcdef";
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 0x0F) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Published vectors for the empty input, one per algorithm. Committed values rather than
    /// self-comparison: a test that hashes twice and compares proves only that the code is
    /// deterministic, not that it computes the algorithm the manifest claims it does.
    #[test]
    fn the_empty_input_matches_the_published_vector_for_every_algorithm() {
        let digests = digest_all(b"");
        assert_eq!(digests.md5, "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(digests.sha1, "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        assert_eq!(
            digests.sha256,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            digests.sha384,
            "38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b"
        );
        assert_eq!(
            digests.sha512,
            "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e"
        );
        assert_eq!(digests.size_bytes, 0);
    }

    #[test]
    fn a_known_input_matches_the_published_vector_for_every_algorithm() {
        let digests = digest_all(b"abc");
        assert_eq!(digests.md5, "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(digests.sha1, "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(
            digests.sha256,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            digests.sha384,
            "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7"
        );
        assert_eq!(
            digests.sha512,
            "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f"
        );
        assert_eq!(digests.size_bytes, 3);
    }

    #[test]
    fn streaming_in_chunks_gives_the_same_answer_as_one_buffer() {
        let bytes: Vec<u8> = (0u8..=255).cycle().take(10_000).collect();
        let whole = digest_all(&bytes);
        let mut running = RunningDigest::new();
        for chunk in bytes.chunks(97) {
            running.update(chunk);
        }
        assert_eq!(running.finish(), whole);
    }

    #[test]
    fn every_digest_is_lowercase_hex_of_the_right_width() {
        let digests = digest_all(b"exhibit");
        for (digest, width) in [
            (&digests.md5, 32),
            (&digests.sha1, 40),
            (&digests.sha256, 64),
            (&digests.sha384, 96),
            (&digests.sha512, 128),
        ] {
            assert_eq!(digest.len(), width);
            assert!(digest
                .chars()
                .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase()));
        }
    }
}
