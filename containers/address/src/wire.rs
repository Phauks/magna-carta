//! Request bodies and their validation.
//!
//! Bodies are parsed by hand from bytes rather than through axum's `Json` extractor, because that
//! extractor's rejection text quotes the offending input back, and the input here is an address a
//! person is typing. Every refusal is one fixed word.

use address_core::{Building, DEFAULT_LIMIT, MAXIMUM_LIMIT, MAXIMUM_QUERY_CHARACTERS};
use serde::Deserialize;

/// The country this engine covers.
pub const COVERED_COUNTRY: &str = "US";
/// The longest building part accepted on `/units`. Far longer than any real one.
const MAXIMUM_BUILDING_PART_CHARACTERS: usize = 200;

/// A refusal, as the one word the error body carries.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Refusal(pub &'static str);

#[derive(Deserialize)]
struct SuggestionBody {
    country: String,
    query: String,
    #[serde(default)]
    limit: Option<i64>,
    #[serde(default)]
    near: Option<String>,
}

#[derive(Deserialize)]
struct UnitsBody {
    country: String,
    building: Building,
}

#[derive(Deserialize)]
struct BuildBody {
    country: String,
}

/// A valid `/suggestions` request.
#[derive(Debug, PartialEq, Eq)]
pub struct SuggestionRequest {
    pub covered: bool,
    pub query: String,
    pub limit: usize,
    pub near: Option<String>,
}

/// A valid `/units` request.
#[derive(Debug, PartialEq, Eq)]
pub struct UnitsRequest {
    pub covered: bool,
    pub building: Building,
}

fn country(value: &str) -> Result<bool, Refusal> {
    if value.len() == 2 && value.bytes().all(|byte| byte.is_ascii_alphabetic()) {
        Ok(value.eq_ignore_ascii_case(COVERED_COUNTRY))
    } else {
        Err(Refusal("invalid-country"))
    }
}

fn region_code(value: &str) -> bool {
    value.len() == 2 && value.bytes().all(|byte| byte.is_ascii_alphabetic())
}

pub fn suggestion_request(body: &[u8]) -> Result<SuggestionRequest, Refusal> {
    let body: SuggestionBody = serde_json::from_slice(body).map_err(|_| Refusal("invalid-body"))?;
    let covered = country(&body.country)?;
    if body.query.chars().count() > MAXIMUM_QUERY_CHARACTERS {
        return Err(Refusal("query-too-long"));
    }
    let limit = match body.limit {
        None => DEFAULT_LIMIT,
        Some(limit) => usize::try_from(limit)
            .ok()
            .filter(|limit| (1..=MAXIMUM_LIMIT).contains(limit))
            .ok_or(Refusal("invalid-limit"))?,
    };
    let near = match body.near {
        None => None,
        Some(near) if near.is_empty() => None,
        Some(near) if region_code(&near) => Some(near.to_ascii_uppercase()),
        Some(_) => return Err(Refusal("invalid-near")),
    };
    Ok(SuggestionRequest {
        covered,
        query: body.query,
        limit,
        near,
    })
}

pub fn units_request(body: &[u8]) -> Result<UnitsRequest, Refusal> {
    let body: UnitsBody = serde_json::from_slice(body).map_err(|_| Refusal("invalid-body"))?;
    let covered = country(&body.country)?;
    let building = body.building;
    let parts = [
        &building.number,
        &building.street,
        &building.city,
        &building.region,
        &building.postcode,
    ];
    if parts
        .iter()
        .any(|part| part.chars().count() > MAXIMUM_BUILDING_PART_CHARACTERS)
        || building.number.trim().is_empty()
        || building.street.trim().is_empty()
        || !(building.region.is_empty() || region_code(&building.region))
    {
        return Err(Refusal("invalid-building"));
    }
    Ok(UnitsRequest { covered, building })
}

/// `true` when the build request names the covered country.
pub fn build_request(body: &[u8]) -> Result<bool, Refusal> {
    let body: BuildBody = serde_json::from_slice(body).map_err(|_| Refusal("invalid-body"))?;
    country(&body.country)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_suggestion_request_takes_defaults_and_normalises_near() {
        let request =
            suggestion_request(br#"{"country":"us","query":"1402 lawson","near":"nc"}"#).unwrap();
        assert!(request.covered);
        assert_eq!(request.limit, DEFAULT_LIMIT);
        assert_eq!(request.near.as_deref(), Some("NC"));
        let other = suggestion_request(br#"{"country":"CA","query":"1 main","limit":10}"#).unwrap();
        assert!(!other.covered);
        assert_eq!(other.limit, 10);
    }

    #[test]
    fn bad_suggestion_requests_are_refused_with_one_word() {
        let long = format!(r#"{{"country":"US","query":"{}"}}"#, "x".repeat(201));
        for (body, word) in [
            (r#"{"query":"1 main"}"#.to_owned(), "invalid-body"),
            (r#"not json"#.to_owned(), "invalid-body"),
            (
                r#"{"country":"USA","query":"1 main"}"#.to_owned(),
                "invalid-country",
            ),
            (
                r#"{"country":"U1","query":"1 main"}"#.to_owned(),
                "invalid-country",
            ),
            (long, "query-too-long"),
            (
                r#"{"country":"US","query":"1 main","limit":0}"#.to_owned(),
                "invalid-limit",
            ),
            (
                r#"{"country":"US","query":"1 main","limit":11}"#.to_owned(),
                "invalid-limit",
            ),
            (
                r#"{"country":"US","query":"1 main","limit":2.5}"#.to_owned(),
                "invalid-body",
            ),
            (
                r#"{"country":"US","query":"1 main","near":"North"}"#.to_owned(),
                "invalid-near",
            ),
        ] {
            assert_eq!(
                suggestion_request(body.as_bytes()),
                Err(Refusal(word)),
                "{body}"
            );
        }
    }

    #[test]
    fn a_units_request_needs_a_number_and_a_street() {
        let good = br#"{"country":"US","building":{"number":"1042","street":"W CENTER ST","city":"OREM","region":"UT","postcode":"84057"}}"#;
        assert!(units_request(good).unwrap().covered);
        let missing = br#"{"country":"US","building":{"number":"","street":"W CENTER ST","city":"","region":"UT","postcode":""}}"#;
        assert_eq!(units_request(missing), Err(Refusal("invalid-building")));
        let partial = br#"{"country":"US","building":{"number":"1"}}"#;
        assert_eq!(units_request(partial), Err(Refusal("invalid-body")));
    }
}
