#![no_main]

use libfuzzer_sys::fuzz_target;

// The mbox lane is total by a different shape: it returns an `MboxParseOutcome`
// (parsed messages plus per-member failures), never a `Result` and never a panic.
// The fuzzer proves that framing an arbitrary buffer and parsing each member stays
// panic-free no matter how the separators fall.
fuzz_target!(|data: &[u8]| {
    let _ = email_core::parse_mbox(data);
});
