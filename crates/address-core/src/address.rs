//! The shapes an answer is made of, serialised exactly as the wire carries them.
//!
//! These are the JSON objects the address worker forwards verbatim to the app worker
//! (`packages/address-lookup/src/self-hosted.ts` reads them), so a field renamed here is a contract
//! change on the other side of a service binding. Field names are single words on purpose: the same
//! spelling in Rust and in JSON, with no renaming layer to drift.

use std::cmp::Ordering;

use serde::{Deserialize, Serialize};

/// One deliverable address: a building, or one unit inside it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Address {
    pub number: String,
    pub street: String,
    /// The unit without its designator (`4`, not `APT 4`); empty for a building with no units.
    pub unit: String,
    pub city: String,
    /// Two-letter state code.
    pub region: String,
    /// Five-digit ZIP code, or empty when the source had none.
    pub postcode: String,
    pub longitude: f64,
    pub latitude: f64,
}

/// A building that holds several units: everything that identifies it, without a unit.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Building {
    pub number: String,
    pub street: String,
    pub city: String,
    pub region: String,
    pub postcode: String,
}

/// One entry in a suggestion list: an address to pick, or a building to open into its units.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Offer {
    Address {
        label: String,
        address: Address,
    },
    Group {
        label: String,
        /// Every unit the index holds for the building, counted exactly rather than taken from however
        /// many happened to rank in the top hits.
        count: u64,
        building: Building,
    },
}

/// The one-line form of an address: `1402 LAWSON CREEK WAY #3, WAKE FOREST, NC 27587`. Empty pieces are
/// left out with their separators, so a row with no city reads `12 MAIN ST, NC 27587`.
pub fn format_label(
    number: &str,
    street: &str,
    unit: &str,
    city: &str,
    region: &str,
    postcode: &str,
) -> String {
    let mut first = format!("{number} {street}");
    if !unit.is_empty() {
        first.push_str(" #");
        first.push_str(unit);
    }
    let tail = [region, postcode]
        .into_iter()
        .filter(|piece| !piece.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    [first.as_str(), city, tail.as_str()]
        .into_iter()
        .filter(|piece| !piece.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

impl Address {
    pub fn label(&self) -> String {
        format_label(
            &self.number,
            &self.street,
            &self.unit,
            &self.city,
            &self.region,
            &self.postcode,
        )
    }

    /// The building this address is in.
    pub fn building(&self) -> Building {
        Building {
            number: self.number.clone(),
            street: self.street.clone(),
            city: self.city.clone(),
            region: self.region.clone(),
            postcode: self.postcode.clone(),
        }
    }
}

impl Building {
    pub fn label(&self) -> String {
        format_label(
            &self.number,
            &self.street,
            "",
            &self.city,
            &self.region,
            &self.postcode,
        )
    }
}

/// Order unit labels the way a person reads them: runs of digits by value, everything else by text, and
/// the building's own row (no unit) first. So `2` sorts before `10`, and `2A` before `2B`.
pub fn natural_order(left: &str, right: &str) -> Ordering {
    let mut left_runs = runs(left);
    let mut right_runs = runs(right);
    loop {
        match (left_runs.next(), right_runs.next()) {
            (None, None) => return left.cmp(right),
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(left_run), Some(right_run)) => {
                let ordering = compare_runs(left_run, right_run);
                if ordering != Ordering::Equal {
                    return ordering;
                }
            }
        }
    }
}

/// Split text into maximal runs of ASCII digits and of everything else.
fn runs(text: &str) -> impl Iterator<Item = &str> {
    let mut rest = text;
    std::iter::from_fn(move || {
        let first = rest.chars().next()?;
        let digits = first.is_ascii_digit();
        let end = rest
            .char_indices()
            .find(|(_, character)| character.is_ascii_digit() != digits)
            .map_or(rest.len(), |(position, _)| position);
        let (run, remainder) = rest.split_at(end);
        rest = remainder;
        Some(run)
    })
}

fn compare_runs(left: &str, right: &str) -> Ordering {
    let left_digits = left.bytes().all(|byte| byte.is_ascii_digit());
    let right_digits = right.bytes().all(|byte| byte.is_ascii_digit());
    match (left_digits, right_digits) {
        (true, true) => {
            // By value without parsing, so a run longer than any integer type still orders correctly:
            // strip leading zeros, then the longer number is the larger, then compare digit by digit.
            let left_value = left.trim_start_matches('0');
            let right_value = right.trim_start_matches('0');
            left_value
                .len()
                .cmp(&right_value.len())
                .then_with(|| left_value.cmp(right_value))
        }
        // A number before a word at the same position: `5` before `A`.
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        (false, false) => left.cmp(right),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn address(unit: &str, city: &str, postcode: &str) -> Address {
        Address {
            number: "1402".to_owned(),
            street: "LAWSON CREEK WAY".to_owned(),
            unit: unit.to_owned(),
            city: city.to_owned(),
            region: "NC".to_owned(),
            postcode: postcode.to_owned(),
            longitude: -78.51,
            latitude: 35.97,
        }
    }

    #[test]
    fn a_label_reads_as_one_line_and_skips_empty_pieces() {
        assert_eq!(
            address("", "WAKE FOREST", "27587").label(),
            "1402 LAWSON CREEK WAY, WAKE FOREST, NC 27587"
        );
        assert_eq!(
            address("3B", "WAKE FOREST", "27587").label(),
            "1402 LAWSON CREEK WAY #3B, WAKE FOREST, NC 27587"
        );
        assert_eq!(
            address("", "", "27587").label(),
            "1402 LAWSON CREEK WAY, NC 27587"
        );
        assert_eq!(
            address("", "WAKE FOREST", "").label(),
            "1402 LAWSON CREEK WAY, WAKE FOREST, NC"
        );
        assert_eq!(
            address("7", "WAKE FOREST", "27587").building().label(),
            "1402 LAWSON CREEK WAY, WAKE FOREST, NC 27587"
        );
    }

    #[test]
    fn offers_serialise_to_the_wire_shape() {
        let offer = Offer::Address {
            label: "label".to_owned(),
            address: address("", "WAKE FOREST", "27587"),
        };
        let json = serde_json::to_value(&offer).expect("serialise");
        assert_eq!(json["kind"], "address");
        assert_eq!(json["address"]["street"], "LAWSON CREEK WAY");
        assert_eq!(json["address"]["longitude"], -78.51);
        let group = Offer::Group {
            label: "label".to_owned(),
            count: 24,
            building: address("", "OREM", "84057").building(),
        };
        let json = serde_json::to_value(&group).expect("serialise");
        assert_eq!(json["kind"], "group");
        assert_eq!(json["count"], 24);
        assert_eq!(json["building"]["city"], "OREM");
        assert!(json["building"].get("unit").is_none());
    }

    #[test]
    fn units_sort_in_natural_order() {
        let mut units = vec!["10", "2", "", "2B", "1", "A", "2A", "010", "B1", "100"];
        units.sort_by(|left, right| natural_order(left, right));
        assert_eq!(
            units,
            vec!["", "1", "2", "2A", "2B", "010", "10", "100", "A", "B1"]
        );
    }
}
