//! Resource ceilings. Every one of them bounds work an adversarial file could otherwise make
//! unbounded: the engine reads privileged, untrusted bytes, so a limit is a refusal, never a clamp.

/// The request body ceiling, matching the platform's general ingest cap. The body is spooled to disk,
/// never held in memory, so this bounds disk use rather than RAM.
pub const MAX_INPUT_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// A box the demuxer loads whole (the movie header and its sample tables).
pub const MAX_MOVIE_HEADER_BYTES: u64 = 256 * 1024 * 1024;

/// Samples per track. A two-hour 60 fps video is 432 000; audio packets run higher.
pub const MAX_SAMPLES_PER_TRACK: usize = 20_000_000;

/// One coded sample. A 4K intra frame at a very high rate is a few megabytes.
pub const MAX_SAMPLE_BYTES: u32 = 64 * 1024 * 1024;

/// Playing time. Six hours covers a full day's deposition session.
pub const MAX_DURATION_SECONDS: i64 = 6 * 60 * 60;

/// The largest picture the decoders will be handed, in luma samples (8K UHD).
pub const MAX_PICTURE_PIXELS: u64 = 7680 * 4320;

/// The rendition is a viewing copy: its long side is at most this, its short side at most
/// `MAX_OUTPUT_SHORT_SIDE`. A larger source is scaled down.
pub const MAX_OUTPUT_LONG_SIDE: u32 = 1920;
pub const MAX_OUTPUT_SHORT_SIDE: u32 = 1080;

/// Audio channels the engine will decode. More are downmixed to stereo.
pub const MAX_AUDIO_CHANNELS: u16 = 8;
