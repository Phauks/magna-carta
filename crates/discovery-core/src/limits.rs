//! Caps for attacker-controlled input. A declared length never sizes an allocation; every violation
//! is a typed error, never a panic, a hang, or a truncated success.
//!
//! Every guard here is checked BEFORE the decoder it protects runs, not after — a ratio ceiling
//! applied to bytes already in memory has already lost. The bounds exist because the material this
//! engine reads is chosen by the party on the other side of the case, and because the engine runs
//! where the stack cannot unwind: an unbounded recursion or allocation is not a slow parse but an
//! aborted isolate.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// The largest input this engine will look at, checked before the format is even identified.
    pub max_input_bytes: usize,
    /// The most extracted text one document may yield. Text is what gets written to R2 and indexed;
    /// a document that decompresses into gigabytes of text is a bomb aimed at the index, not a
    /// document.
    pub max_extracted_text_bytes: usize,
    /// The most pages one document may be read from. A page count is declared in the file for some
    /// formats, so it is attacker-controlled.
    pub max_page_count: usize,
    /// How deep an XML element tree may nest before the walk refuses it. A pull parser does not
    /// recurse, so this bounds retained state rather than the stack, but a document nested tens of
    /// thousands deep is a bomb either way.
    pub max_xml_depth: usize,
    /// The most XML events one part may produce. The depth cap alone does not bound a flat file of
    /// a hundred million empty elements.
    pub max_xml_events: usize,
    /// The most entries an archive may declare before it is refused whole. Read from the central
    /// directory, before any decompression.
    pub max_archive_entries: usize,
    /// How deep archives may nest before entries are recorded rather than expanded. Three clears
    /// every real production (a zip of per-record-custodian zips of per-mailbox zips); past it, an archive
    /// is a leaf whose contents are described honestly instead of opened.
    pub max_archive_nesting_depth: usize,
    /// The total decompressed bytes one archive may yield across every entry at every depth.
    pub max_expanded_bytes: u64,
    /// The most one entry may decompress to.
    pub max_entry_bytes: u64,
    /// The largest expansion factor an archive may achieve overall. A zip bomb's whole mechanism is
    /// a ratio in the thousands; real productions of documents sit in the single digits, and even a
    /// zip of pure text rarely clears twenty.
    pub max_expansion_ratio: u64,
    /// The most shingles the fingerprint will hash. The fingerprint is a fixed-width value over an
    /// unbounded text, so the work has to be bounded somewhere; it is bounded here rather than by
    /// truncating the text, so the same text always fingerprints the same way.
    pub max_fingerprint_shingles: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_input_bytes: 2 * 1024 * 1024 * 1024,
            max_extracted_text_bytes: 256 * 1024 * 1024,
            max_page_count: 50_000,
            max_xml_depth: 256,
            max_xml_events: 20_000_000,
            max_archive_entries: 100_000,
            max_archive_nesting_depth: 3,
            max_expanded_bytes: 8 * 1024 * 1024 * 1024,
            max_entry_bytes: 2 * 1024 * 1024 * 1024,
            max_expansion_ratio: 200,
            max_fingerprint_shingles: 200_000,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_defaults_are_the_values_the_guards_were_reasoned_about_at() {
        // Pinned rather than merely present: a guard's default IS the guard, and moving one silently
        // is how a ceiling stops holding.
        let limits = Limits::default();
        assert_eq!(limits.max_archive_nesting_depth, 3);
        assert_eq!(limits.max_expansion_ratio, 200);
        assert_eq!(limits.max_archive_entries, 100_000);
        assert_eq!(limits.max_xml_depth, 256);
    }
}
