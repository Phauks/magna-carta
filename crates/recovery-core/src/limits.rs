//! Shared salvage caps. Untrusted input must never exhaust container memory:
//! every pillar bounds per-item output, aggregate output, and item count.

/// Maximum decompressed/extracted bytes for a single item (entry/stream).
pub const MAX_ENTRY_UNCOMPRESSED_BYTES: u64 = 512 * 1024 * 1024;
/// Maximum decompressed/extracted bytes across all recovered items in one file.
pub const MAX_TOTAL_UNCOMPRESSED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// Maximum number of items (entries/streams) processed from one file.
pub const MAX_ENTRY_COUNT: usize = 100_000;
