//! Empirical RSS comparison of the two scan transports' SERVICE-side memory on a file.
//!
//! - `mmap`   — Option B's SCAN path: memory-map the scratch file and touch every byte (as yara + the
//!   structural heuristics do when they scan the mapped bytes). The resident pages are FILE-backed
//!   (`RssFile`) — the kernel can reclaim them under memory pressure and re-read from disk.
//! - `buffer` — the INSTREAM path: read the whole file into a heap `Vec<u8>` (as axum's `to_bytes`
//!   does before streaming to clamd). The bytes are ANONYMOUS (`RssAnon`) — not file-backed, so they
//!   cannot be reclaimed; each concurrent scan holds ~1× the file hard in RAM.
//!
//! The binding constraint on how many scans fit per instance is `RssAnon` (anonymous memory can only be
//! swapped, not dropped). This isolates the part OUR code controls; clamd's own per-scan memory is a
//! separate process and DB-dominated. Run both modes (fresh process each) and compare `RssAnon`.
use std::io::Read;

use memmap2::Mmap;

// Reads (RssAnon, RssFile, VmHWM) in kB from /proc/self/status. VmHWM is peak RSS since start.
fn rss_kb() -> (u64, u64, u64) {
    let status = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    let field = |name: &str| -> u64 {
        status
            .lines()
            .find(|line| line.starts_with(name))
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0)
    };
    (field("RssAnon:"), field("RssFile:"), field("VmHWM:"))
}

fn report(mode: &str) {
    let (anon, file, hwm) = rss_kb();
    println!(
        "[{mode:>6}] RssAnon={:>7} MiB   RssFile={:>7} MiB   VmHWM(peak)={:>7} MiB",
        anon / 1024,
        file / 1024,
        hwm / 1024,
    );
}

fn main() {
    let mode = std::env::args().nth(1).unwrap_or_else(|| "mmap".into());
    let path = std::env::args()
        .nth(2)
        .expect("usage: rss-bench <mmap|buffer> <file>");

    match mode.as_str() {
        // SCAN path: mmap + touch every byte (file-backed RssFile, reclaimable).
        "mmap" => {
            let file = std::fs::File::open(&path).expect("open");
            // SAFETY: the file is read-only for the lifetime of the map (this benchmark never writes it).
            let map = unsafe { Mmap::map(&file) }.expect("mmap");
            let mut checksum = 0u64;
            for &byte in map.iter() {
                checksum = checksum.wrapping_add(byte as u64);
            }
            std::hint::black_box(checksum);
            report("mmap");
            std::hint::black_box(&map); // keep the map resident through the measurement
        }
        // INSTREAM path: read into a heap Vec (anonymous RssAnon, not reclaimable).
        "buffer" => {
            let mut buffer = Vec::new();
            std::fs::File::open(&path)
                .expect("open")
                .read_to_end(&mut buffer)
                .expect("read");
            std::hint::black_box(buffer.len());
            report("buffer");
            std::hint::black_box(&buffer); // keep the buffer resident through the measurement
        }
        other => {
            eprintln!("unknown mode {other:?}; use mmap or buffer");
            std::process::exit(2);
        }
    }
}
