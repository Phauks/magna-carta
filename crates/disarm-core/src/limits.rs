//! The ceilings every format checks. A disarm reads a whole document, and an Office package or a
//! picture can claim far more than it carries, so each one is bounded before any work is done.

/// Size, count and expansion ceilings. The defaults suit a matter document; a caller with a tighter
/// memory budget (a browser tab, a Worker isolate) passes smaller ones.
#[derive(Debug, Clone)]
pub struct Limits {
    /// The largest input accepted at all.
    pub max_input_bytes: usize,
    /// The most entries an Office package may hold.
    pub max_package_entries: usize,
    /// The largest any one package part may inflate to.
    pub max_part_bytes: u64,
    /// The most a whole package may inflate to, embedded packages included.
    pub max_package_inflated_bytes: u64,
    /// How deep embedded packages are followed (a workbook inside a document inside a document).
    pub max_package_depth: u8,
    /// The most pixels a picture may decode to.
    pub max_image_pixels: u64,
    /// The deepest an RTF group may nest.
    pub max_rtf_depth: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_input_bytes: 256 * 1024 * 1024,
            max_package_entries: 20_000,
            max_part_bytes: 512 * 1024 * 1024,
            max_package_inflated_bytes: 1024 * 1024 * 1024,
            max_package_depth: 3,
            max_image_pixels: 100_000_000,
            max_rtf_depth: 512,
        }
    }
}
