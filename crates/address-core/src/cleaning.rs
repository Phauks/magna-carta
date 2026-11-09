//! Turning one source row into the address the index holds, and deciding whether it has been seen.
//!
//! Source rows come from hundreds of county and city publishers who agree on nothing: case, punctuation,
//! `STREET` against `ST`, a unit written `APT 4`, `#4` or `UNIT 4`, a nine-digit postcode or none. The
//! index matches words exactly, so every row is brought to one spelling before it is indexed, and the
//! query side (`query.rs`) brings typed text to the same spelling with the same tables.
//!
//! Statewide and county files overlap heavily (a fifth of rows were duplicates on the measured sample),
//! so a row is also reduced to a duplicate key. Keys are kept per state: an address never appears in two
//! states, so the set of keys held at once is bounded by the largest state rather than the country.

use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasherDefault, Hasher};

use crate::address::Address;

/// The longest any one cleaned field may be, in characters. Real street, city and unit values are far
/// shorter; a longer one is a malformed row (a whole record pasted into one column), and indexing it in
/// full would only bloat the dictionary with words nobody types.
pub const MAXIMUM_FIELD_CHARACTERS: usize = 120;

/// One row as a source publishes it, before cleaning. Borrowed, so a streaming build allocates only for
/// the rows it keeps.
#[derive(Clone, Copy, Debug)]
pub struct SourceRow<'a> {
    pub number: &'a str,
    pub street: &'a str,
    pub unit: &'a str,
    pub city: &'a str,
    pub postcode: &'a str,
    pub longitude: f64,
    pub latitude: f64,
}

/// Uppercase; every character that is not a letter, a digit, `#` or `-` becomes a space; runs of spaces
/// collapse to one; no leading or trailing space. Capped at [`MAXIMUM_FIELD_CHARACTERS`].
pub fn normalise(text: &str) -> String {
    normalise_capped(text, MAXIMUM_FIELD_CHARACTERS)
}

/// [`normalise`], capped at `maximum_characters` instead.
pub fn normalise_capped(text: &str, maximum_characters: usize) -> String {
    let mut output = String::with_capacity(text.len());
    let mut characters = 0usize;
    let mut pending_space = false;
    for character in text.chars() {
        if character.is_alphanumeric() || character == '#' || character == '-' {
            if pending_space && !output.is_empty() {
                if characters >= maximum_characters {
                    return output;
                }
                output.push(' ');
                characters += 1;
            }
            pending_space = false;
            for upper in character.to_uppercase() {
                if characters >= maximum_characters {
                    return output;
                }
                output.push(upper);
                characters += 1;
            }
        } else {
            pending_space = true;
        }
    }
    output
}

/// USPS street suffix abbreviations (Publication 28, the common entries), sorted by the long form so a
/// lookup is a binary search. Only the long form is mapped: a source that already wrote `AVE` is left as
/// it is.
const STREET_SUFFIXES: &[(&str, &str)] = &[
    ("ALLEY", "ALY"),
    ("AVENUE", "AVE"),
    ("BOULEVARD", "BLVD"),
    ("BRANCH", "BR"),
    ("BRIDGE", "BRG"),
    ("BROOK", "BRK"),
    ("BYPASS", "BYP"),
    ("CAUSEWAY", "CSWY"),
    ("CENTER", "CTR"),
    ("CIRCLE", "CIR"),
    ("CLIFF", "CLF"),
    ("COMMON", "CMN"),
    ("CORNER", "COR"),
    ("COURT", "CT"),
    ("COVE", "CV"),
    ("CREEK", "CRK"),
    ("CRESCENT", "CRES"),
    ("CROSSING", "XING"),
    ("DRIVE", "DR"),
    ("ESTATE", "EST"),
    ("ESTATES", "ESTS"),
    ("EXPRESSWAY", "EXPY"),
    ("EXTENSION", "EXT"),
    ("FREEWAY", "FWY"),
    ("GARDEN", "GDN"),
    ("GARDENS", "GDNS"),
    ("GLEN", "GLN"),
    ("GREEN", "GRN"),
    ("GROVE", "GRV"),
    ("HARBOR", "HBR"),
    ("HEIGHTS", "HTS"),
    ("HIGHWAY", "HWY"),
    ("HILL", "HL"),
    ("HILLS", "HLS"),
    ("HOLLOW", "HOLW"),
    ("ISLAND", "IS"),
    ("JUNCTION", "JCT"),
    ("KNOLL", "KNL"),
    ("LAKE", "LK"),
    ("LANDING", "LNDG"),
    ("LANE", "LN"),
    ("MANOR", "MNR"),
    ("MEADOW", "MDW"),
    ("MEADOWS", "MDWS"),
    ("MILL", "ML"),
    ("MOUNT", "MT"),
    ("MOUNTAIN", "MTN"),
    ("PARKWAY", "PKWY"),
    ("PLACE", "PL"),
    ("PLAZA", "PLZ"),
    ("POINT", "PT"),
    ("RIDGE", "RDG"),
    ("ROAD", "RD"),
    ("ROUTE", "RTE"),
    ("SQUARE", "SQ"),
    ("STATION", "STA"),
    ("STREET", "ST"),
    ("SUMMIT", "SMT"),
    ("TERRACE", "TER"),
    ("TRACE", "TRCE"),
    ("TRAIL", "TRL"),
    ("TURNPIKE", "TPKE"),
    ("VALLEY", "VLY"),
    ("VIEW", "VW"),
    ("VILLAGE", "VLG"),
    ("VISTA", "VIS"),
];

/// USPS directional abbreviations, sorted by the long form.
const DIRECTIONALS: &[(&str, &str)] = &[
    ("EAST", "E"),
    ("NORTH", "N"),
    ("NORTHEAST", "NE"),
    ("NORTHWEST", "NW"),
    ("SOUTH", "S"),
    ("SOUTHEAST", "SE"),
    ("SOUTHWEST", "SW"),
    ("WEST", "W"),
];

/// The designators a unit value is written with, stripped so `APT 4`, `#4` and `UNIT 4` are one unit.
const UNIT_DESIGNATORS: &[&str] = &["#", "APARTMENT", "APT", "NO", "STE", "SUITE", "UNIT"];

fn lookup(table: &'static [(&'static str, &'static str)], word: &str) -> Option<&'static str> {
    table
        .binary_search_by(|(long, _)| (*long).cmp(word))
        .ok()
        .and_then(|position| table.get(position))
        .map(|(_, short)| *short)
}

fn suffix_abbreviation(word: &str) -> Option<&'static str> {
    lookup(STREET_SUFFIXES, word)
}

fn directional_abbreviation(word: &str) -> Option<&'static str> {
    lookup(DIRECTIONALS, word)
}

/// The USPS abbreviation of an uppercase word in any position, if it has one. The query side uses this
/// for words a person typed in full (`street`, `north`), offering the abbreviation as an alternative
/// rather than a replacement, because a source only abbreviates a word in suffix or directional position.
pub fn abbreviation(word: &str) -> Option<&'static str> {
    suffix_abbreviation(word).or_else(|| directional_abbreviation(word))
}

/// Abbreviate an already-normalised street name the way USPS standardises one: a leading directional
/// (`WEST CENTER STREET` -> `W ...`), a trailing directional (`... STREET NORTH` -> `... N`), and the
/// suffix, which is the last word or the one before a trailing directional. Words elsewhere keep their
/// spelling, so `LAWSON CREEK WAY` stays `LAWSON CREEK WAY` and `COURT STREET` becomes `COURT ST`.
/// A directional or suffix that is the whole name (`WEST ST`, `STREET RD`) is the name, and is kept.
pub fn abbreviate_street(normalised: &str) -> String {
    let mut words: Vec<String> = normalised.split(' ').map(str::to_owned).collect();
    let count = words.len();
    if count < 2 {
        return normalised.to_owned();
    }
    let mut suffix_at = count - 1;
    if count >= 3 {
        if let Some(short) = words.last().and_then(|last| directional_abbreviation(last)) {
            if let Some(last) = words.last_mut() {
                *last = short.to_owned();
            }
            suffix_at = count - 2;
        }
    }
    if suffix_at >= 1 {
        if let Some(word) = words.get_mut(suffix_at) {
            if let Some(short) = suffix_abbreviation(word) {
                *word = short.to_owned();
            }
        }
    }
    // A leading directional only when at least a name and a suffix follow it, so a street called
    // `WEST ST` is not turned into `W ST`.
    if count >= 3 && suffix_at >= 2 {
        if let Some(first) = words.first_mut() {
            if let Some(short) = directional_abbreviation(first) {
                *first = short.to_owned();
            }
        }
    }
    words.join(" ")
}

/// A unit value without its designator: `APT 4`, `UNIT #4`, `#4` and `NO 4` are all `4`.
pub fn clean_unit(raw: &str) -> String {
    let normalised = normalise(raw);
    let mut words: Vec<&str> = normalised
        .split(' ')
        .filter(|word| !word.is_empty())
        .collect();
    while words
        .first()
        .is_some_and(|first| UNIT_DESIGNATORS.contains(first))
    {
        words.remove(0);
    }
    if let Some(first) = words.first_mut() {
        *first = first.trim_start_matches('#');
    }
    words
        .into_iter()
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// The five-digit ZIP code at the start of a postcode, or nothing when there are fewer than five digits
/// there (a ZIP+4 keeps its first five; a value that lost its leading zero is not guessed at).
pub fn clean_postcode(raw: &str) -> String {
    let digits: String = raw
        .trim()
        .chars()
        .take_while(char::is_ascii_digit)
        .take(5)
        .collect();
    if digits.len() == 5 {
        digits
    } else {
        String::new()
    }
}

fn valid_coordinates(longitude: f64, latitude: f64) -> bool {
    longitude.is_finite()
        && latitude.is_finite()
        && (-180.0..=180.0).contains(&longitude)
        && (-90.0..=90.0).contains(&latitude)
        // A row placed at exactly 0,0 was geocoded by nobody.
        && !(longitude == 0.0 && latitude == 0.0)
}

/// Clean one source row for `region` (a two-letter state code, taken from the source's own name because
/// most per-county files leave the row's region empty). A row with no number, no street or no usable
/// coordinates is dropped: it cannot be offered as an address.
pub fn clean(row: &SourceRow<'_>, region: &str) -> Option<Address> {
    let number = normalise(row.number);
    let street = abbreviate_street(&normalise(row.street));
    if number.is_empty() || street.is_empty() || !valid_coordinates(row.longitude, row.latitude) {
        return None;
    }
    Some(Address {
        number,
        street,
        unit: clean_unit(row.unit),
        city: normalise(row.city),
        region: normalise(region),
        postcode: clean_postcode(row.postcode),
        longitude: row.longitude,
        latitude: row.latitude,
    })
}

/// FNV-1a, 64-bit. Chosen because its output is fixed by its definition: the standard library's hasher
/// is free to change between releases, and a duplicate key that changed meaning mid-build would let a
/// duplicate through. Collisions across one state's keys (tens of millions) are vanishingly rare, and a
/// collision only drops one row as a duplicate.
fn stable_hash(parts: &[&str]) -> u64 {
    const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    let mut hash = OFFSET_BASIS;
    for (position, part) in parts.iter().enumerate() {
        if position > 0 {
            hash ^= u64::from(b'|');
            hash = hash.wrapping_mul(PRIME);
        }
        for byte in part.bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(PRIME);
        }
    }
    hash
}

/// The duplicate key of a cleaned address: `number|street|unit|postcode-or-city`, hashed.
pub fn duplicate_key(address: &Address) -> u64 {
    let place = if address.postcode.is_empty() {
        address.city.as_str()
    } else {
        address.postcode.as_str()
    };
    stable_hash(&[&address.number, &address.street, &address.unit, place])
}

/// A hasher that passes a `u64` through untouched. The keys are already well-mixed hashes, so hashing
/// them again would only spend time on every one of tens of millions of rows.
#[derive(Default)]
struct PassThroughHasher(u64);

impl Hasher for PassThroughHasher {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 = self.0.rotate_left(8) ^ u64::from(*byte);
        }
    }

    fn write_u64(&mut self, value: u64) {
        self.0 = value;
    }
}

type KeySet = HashSet<u64, BuildHasherDefault<PassThroughHasher>>;

/// Remembers the duplicate keys seen so far, per state.
#[derive(Default)]
pub struct Deduplicator {
    seen: HashMap<String, KeySet>,
}

impl Deduplicator {
    pub fn new() -> Self {
        Self::default()
    }

    /// True the first time an address is offered, false for every duplicate of it after.
    pub fn admit(&mut self, address: &Address) -> bool {
        let key = duplicate_key(address);
        match self.seen.get_mut(&address.region) {
            Some(keys) => keys.insert(key),
            None => {
                let mut keys = KeySet::default();
                keys.insert(key);
                self.seen.insert(address.region.clone(), keys);
                true
            }
        }
    }

    /// Drop every state's keys. A build calls this between partitions: no state spans two, so the keys
    /// of a finished partition can never match again.
    pub fn forget_all(&mut self) {
        self.seen.clear();
    }

    /// How many distinct keys are held, across states.
    pub fn len(&self) -> usize {
        self.seen.values().map(HashSet::len).sum()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row<'a>(
        number: &'a str,
        street: &'a str,
        unit: &'a str,
        postcode: &'a str,
    ) -> SourceRow<'a> {
        SourceRow {
            number,
            street,
            unit,
            city: "Wake Forest",
            postcode,
            longitude: -78.51,
            latitude: 35.97,
        }
    }

    #[test]
    fn the_tables_are_sorted_for_binary_search() {
        for table in [STREET_SUFFIXES, DIRECTIONALS] {
            let mut sorted = table.to_vec();
            sorted.sort_by(|left, right| left.0.cmp(right.0));
            assert_eq!(sorted, table.to_vec());
        }
    }

    #[test]
    fn normalising_uppercases_and_keeps_only_letters_digits_hash_and_hyphen() {
        assert_eq!(
            normalise("  1402  lawson-creek, way. "),
            "1402 LAWSON-CREEK WAY"
        );
        assert_eq!(normalise("apt #4/b"), "APT #4 B");
        assert_eq!(normalise("Calle Peña"), "CALLE PEÑA");
        assert_eq!(normalise(""), "");
        assert_eq!(
            normalise(&"x".repeat(500)).chars().count(),
            MAXIMUM_FIELD_CHARACTERS
        );
    }

    #[test]
    fn a_street_is_abbreviated_only_in_suffix_and_directional_position() {
        assert_eq!(abbreviate_street("LAWSON CREEK WAY"), "LAWSON CREEK WAY");
        assert_eq!(abbreviate_street("WEST CENTER STREET"), "W CENTER ST");
        assert_eq!(abbreviate_street("MAIN STREET NORTH"), "MAIN ST N");
        assert_eq!(abbreviate_street("COURT STREET"), "COURT ST");
        assert_eq!(abbreviate_street("WEST STREET"), "WEST ST");
        assert_eq!(abbreviate_street("PARK AVENUE"), "PARK AVE");
        assert_eq!(abbreviate_street("BROADWAY"), "BROADWAY");
        assert_eq!(abbreviate_street("OLD US 1 HWY"), "OLD US 1 HWY");
    }

    #[test]
    fn a_unit_loses_its_designator() {
        assert_eq!(clean_unit("Apt 4"), "4");
        assert_eq!(clean_unit("#4"), "4");
        assert_eq!(clean_unit("UNIT #12B"), "12B");
        assert_eq!(clean_unit("Suite 200"), "200");
        assert_eq!(clean_unit("No. 5"), "5");
        assert_eq!(clean_unit("NORTH"), "NORTH");
        assert_eq!(clean_unit("APT"), "");
        assert_eq!(clean_unit(""), "");
    }

    #[test]
    fn a_postcode_is_cut_to_five_digits_or_dropped() {
        assert_eq!(clean_postcode("27587-1234"), "27587");
        assert_eq!(clean_postcode("275871234"), "27587");
        assert_eq!(clean_postcode("2134"), "");
        assert_eq!(clean_postcode("N/A"), "");
    }

    #[test]
    fn a_row_without_a_number_street_or_coordinates_is_dropped() {
        assert!(clean(&row("", "Main St", "", "27587"), "NC").is_none());
        assert!(clean(&row("12", " , ", "", "27587"), "NC").is_none());
        let mut nowhere = row("12", "Main St", "", "27587");
        nowhere.longitude = 0.0;
        nowhere.latitude = 0.0;
        assert!(clean(&nowhere, "NC").is_none());
        let mut broken = row("12", "Main St", "", "27587");
        broken.latitude = f64::NAN;
        assert!(clean(&broken, "NC").is_none());
    }

    #[test]
    fn a_row_is_cleaned_field_by_field() {
        let cleaned = clean(
            &row("1402", "Lawson Creek Way", "Apt 3", "27587-0001"),
            "nc",
        )
        .expect("a complete row");
        assert_eq!(cleaned.number, "1402");
        assert_eq!(cleaned.street, "LAWSON CREEK WAY");
        assert_eq!(cleaned.unit, "3");
        assert_eq!(cleaned.city, "WAKE FOREST");
        assert_eq!(cleaned.region, "NC");
        assert_eq!(cleaned.postcode, "27587");
    }

    #[test]
    fn duplicates_are_caught_across_spellings_and_kept_apart_across_states() {
        let mut deduplicator = Deduplicator::new();
        let first = clean(&row("12", "Main Street", "Apt 4", "27587"), "NC").expect("row");
        let same = clean(&row("12", "MAIN ST", "#4", "27587-9999"), "NC").expect("row");
        let other_unit = clean(&row("12", "Main St", "5", "27587"), "NC").expect("row");
        let other_state = clean(&row("12", "Main St", "4", "27587"), "NV").expect("row");
        assert!(deduplicator.admit(&first));
        assert!(!deduplicator.admit(&same));
        assert!(deduplicator.admit(&other_unit));
        assert!(deduplicator.admit(&other_state));
        assert_eq!(deduplicator.len(), 3);
        deduplicator.forget_all();
        assert!(deduplicator.is_empty());
        assert!(deduplicator.admit(&first));
    }

    #[test]
    fn the_duplicate_key_falls_back_to_the_city_without_a_postcode() {
        let with_city = clean(&row("12", "Main St", "", ""), "NC").expect("row");
        let mut elsewhere = with_city.clone();
        elsewhere.city = "RALEIGH".to_owned();
        assert_ne!(duplicate_key(&with_city), duplicate_key(&elsewhere));
    }

    #[test]
    fn the_duplicate_key_is_stable_across_builds() {
        // Pinned: if this value changes, the hash changed, and a build mixing old and new keys would
        // stop recognising duplicates.
        assert_eq!(stable_hash(&["a"]), 0xaf63_dc4c_8601_ec8c);
    }
}
