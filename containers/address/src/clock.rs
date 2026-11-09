//! Wall-clock formatting for build ids and the timestamps the pointer and build status carry. Small
//! enough to write out rather than take a date library for: UTC only, whole seconds only.

use std::time::{SystemTime, UNIX_EPOCH};

/// Seconds since the Unix epoch, now.
pub fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

/// The civil UTC date and time of a Unix timestamp: (year, month, day, hour, minute, second).
fn civil(seconds: u64) -> (i64, u32, u32, u32, u32, u32) {
    let days = i64::try_from(seconds / 86_400).unwrap_or_default();
    let of_day = seconds % 86_400;
    // Howard Hinnant's days-to-civil algorithm, exact for the proleptic Gregorian calendar.
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    let narrow = |value: i64| u32::try_from(value).unwrap_or_default();
    let narrow_seconds = |value: u64| u32::try_from(value).unwrap_or_default();
    (
        year,
        narrow(month),
        narrow(day),
        narrow_seconds(of_day / 3600),
        narrow_seconds(of_day % 3600 / 60),
        narrow_seconds(of_day % 60),
    )
}

/// `2026-10-02T03:15:00Z`.
pub fn timestamp(seconds: u64) -> String {
    let (year, month, day, hour, minute, second) = civil(seconds);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// `20261002T031500Z`: sortable, and safe in an object key.
pub fn build_identifier(seconds: u64) -> String {
    let (year, month, day, hour, minute, second) = civil(seconds);
    format!("{year:04}{month:02}{day:02}T{hour:02}{minute:02}{second:02}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps_are_utc_civil_time() {
        assert_eq!(timestamp(0), "1970-01-01T00:00:00Z");
        // 2026-10-02T03:15:09Z
        assert_eq!(timestamp(1_790_910_909), "2026-10-02T03:15:09Z");
        assert_eq!(build_identifier(1_790_910_909), "20261002T031509Z");
        // A leap day.
        assert_eq!(timestamp(1_709_164_800), "2024-02-29T00:00:00Z");
    }
}
