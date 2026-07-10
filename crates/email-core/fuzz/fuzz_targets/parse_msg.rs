#![no_main]

use libfuzzer_sys::fuzz_target;

// The `.msg` lane wraps a CFB/OLE2 container parser over attacker-controlled bytes.
// Its contract is total: any byte string yields `Ok` or a typed `Err`, never a panic.
// A panic here would abort the wasm isolate, so the fuzzer holds the whole open/walk/
// decode path — including `cfb`'s — to that guarantee.
fuzz_target!(|data: &[u8]| {
    let _ = email_core::parse_msg(data);
});
