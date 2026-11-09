//! The four partitions the country's index is split into: the four census regions.
//!
//! One index for the whole country cannot be built on a build container's disk, because merging it into
//! one segment needs about twice its size. A census region is the largest unit that fits with room, and
//! OpenAddresses uses the same four for its own collections. A query reads all four in parallel, so the
//! split costs one round trip, not four.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Partition {
    Northeast,
    Midwest,
    South,
    West,
}

const NORTHEAST: &[&str] = &["CT", "MA", "ME", "NH", "NJ", "NY", "PA", "RI", "VT"];
const MIDWEST: &[&str] = &[
    "IA", "IL", "IN", "KS", "MI", "MN", "MO", "ND", "NE", "OH", "SD", "WI",
];
const SOUTH: &[&str] = &[
    "AL", "AR", "DC", "DE", "FL", "GA", "KY", "LA", "MD", "MS", "NC", "OK", "PR", "SC", "TN", "TX",
    "VA", "WV",
];
const WEST: &[&str] = &[
    "AK", "AZ", "CA", "CO", "HI", "ID", "MT", "NM", "NV", "OR", "UT", "WA", "WY",
];
/// Territories other than Puerto Rico. They ride with `south`, like Puerto Rico, and are listed so a
/// typed `GU` is still recognised as a region code by the query.
const OTHER_TERRITORIES: &[&str] = &["AS", "GU", "MP", "UM", "VI"];

impl Partition {
    /// Every partition, in the order a build writes them and a pointer lists them.
    pub const ALL: [Partition; 4] = [
        Partition::Northeast,
        Partition::Midwest,
        Partition::South,
        Partition::West,
    ];

    /// The name used in object keys and the pointer: `northeast`, `midwest`, `south`, `west`.
    pub fn name(self) -> &'static str {
        match self {
            Partition::Northeast => "northeast",
            Partition::Midwest => "midwest",
            Partition::South => "south",
            Partition::West => "west",
        }
    }

    pub fn from_name(name: &str) -> Option<Partition> {
        Partition::ALL
            .into_iter()
            .find(|partition| partition.name() == name)
    }

    /// The partition a two-letter state code belongs to, in either case. Puerto Rico, every other
    /// territory, and anything unrecognised go to `south`, so no row is ever without a partition.
    pub fn for_state(code: &str) -> Partition {
        let upper = code.trim().to_ascii_uppercase();
        let code = upper.as_str();
        if NORTHEAST.contains(&code) {
            Partition::Northeast
        } else if MIDWEST.contains(&code) {
            Partition::Midwest
        } else if WEST.contains(&code) {
            Partition::West
        } else {
            Partition::South
        }
    }
}

/// Whether an uppercase two-letter word is a state or territory code. The query treats such a word as
/// matching either the address's words or its region, so a pasted `..., RALEIGH, NC 27601` still finds
/// the address even though the region is not one of the indexed words.
pub fn is_region_code(word: &str) -> bool {
    [NORTHEAST, MIDWEST, SOUTH, WEST, OTHER_TERRITORIES]
        .iter()
        .any(|codes| codes.contains(&word))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_state_and_the_district_has_exactly_one_partition() {
        let all: Vec<&str> = [NORTHEAST, MIDWEST, SOUTH, WEST].concat();
        assert_eq!(all.len(), 52, "50 states, DC and Puerto Rico");
        let mut unique = all.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), all.len());
    }

    #[test]
    fn states_map_to_their_census_region() {
        assert_eq!(Partition::for_state("NC"), Partition::South);
        assert_eq!(Partition::for_state("nv"), Partition::West);
        assert_eq!(Partition::for_state("NY"), Partition::Northeast);
        assert_eq!(Partition::for_state("OH"), Partition::Midwest);
        assert_eq!(Partition::for_state("PR"), Partition::South);
    }

    #[test]
    fn territories_and_unknown_codes_go_south() {
        assert_eq!(Partition::for_state("GU"), Partition::South);
        assert_eq!(Partition::for_state("VI"), Partition::South);
        assert_eq!(Partition::for_state(""), Partition::South);
        assert_eq!(Partition::for_state("ZZ"), Partition::South);
    }

    #[test]
    fn names_round_trip() {
        for partition in Partition::ALL {
            assert_eq!(Partition::from_name(partition.name()), Some(partition));
        }
        assert_eq!(Partition::from_name("pacific"), None);
        assert_eq!(
            serde_json::to_string(&Partition::Northeast).expect("serialise"),
            "\"northeast\""
        );
    }

    #[test]
    fn region_codes_are_recognised() {
        assert!(is_region_code("NC"));
        assert!(is_region_code("GU"));
        assert!(!is_region_code("ST"));
        assert!(!is_region_code("nc"));
    }
}
