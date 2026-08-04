//! Reading a worker child's resident set.
//!
//! LibreOffice's resident set on a pathological document is not bounded by anything we control, so
//! the per-worker ceiling plus recycling is the answer — and it is deliberately per-worker rather
//! than per-container, because without it the alternative outcome is the platform
//! out-of-memory-killing the whole instance and taking every in-flight conversion with it.

/// The kernel's view of a process's resident set, in kibibytes.
///
/// `None` on any platform without `/proc` (a developer's machine), which is why the pool takes the
/// larger of this and the worker's self-reported figure rather than relying on either alone: the
/// kernel's number cannot be under-reported by a confused child, and the child's number is
/// available everywhere.
pub fn resident_kibibytes(process_identifier: u32) -> Option<u64> {
    let statm = std::fs::read_to_string(format!("/proc/{process_identifier}/statm")).ok()?;
    // `statm` is whitespace-separated page counts; the second field is the resident set.
    let resident_pages: u64 = statm.split_whitespace().nth(1)?.parse().ok()?;
    Some(resident_pages.saturating_mul(page_kibibytes()))
}

/// The page size in kibibytes. The container image is `linux/amd64`, where this is 4; the constant
/// is named rather than inlined so a future architecture change has one place to look.
const fn page_kibibytes() -> u64 {
    4
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    #[test]
    fn this_process_reports_a_plausible_resident_set() {
        let resident = resident_kibibytes(std::process::id())
            .expect("/proc must be readable for the running process on linux");
        // A running test binary is comfortably above a mebibyte and nowhere near a terabyte; the
        // assertion is that the field was parsed and scaled, not a measurement.
        assert!(
            (1_024..1_073_741_824).contains(&resident),
            "implausible resident set: {resident} KiB"
        );
    }

    #[test]
    fn an_unknown_process_reports_nothing_rather_than_zero() {
        // Process identifier 0 is never a readable /proc entry on any platform. "Unknown" must be
        // distinguishable from "small", or an unreadable worker would look permanently healthy.
        assert_eq!(resident_kibibytes(0), None);
    }
}
