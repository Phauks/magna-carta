#![no_main]

use libfuzzer_sys::fuzz_target;

// The `.eml` lane's contract is total: any byte string yields `Ok` or a typed `Err`,
// never a panic. This engine ships to an isolate that cannot unwind, so a panic on
// hostile input aborts the whole isolate — the fuzzer exists to prove no input does.
fuzz_target!(|data: &[u8]| {
    let _ = email_core::parse_eml(data);
});
