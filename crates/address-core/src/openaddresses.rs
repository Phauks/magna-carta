//! Reading OpenAddresses per-source output: one GeoJSON `Feature` per line.
//!
//! `{"type":"Feature","properties":{"number","street","unit","city","district","region","postcode",
//! "hash",...},"geometry":{"type":"Point","coordinates":[longitude, latitude]}}`
//!
//! The region on a row is usually empty in county files, so the state is taken from the source's name
//! (`us/nc/wake` is North Carolina) by [`state_of_source`] and passed to cleaning alongside the row.

use serde::de::{self, Deserializer, Visitor};
use serde::Deserialize;

use crate::address::Address;
use crate::cleaning::{clean, SourceRow};

/// A property value as publishers write it: usually a string, sometimes a number, sometimes null.
#[derive(Default)]
struct Lenient(String);

impl<'de> Deserialize<'de> for Lenient {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct LenientVisitor;
        impl Visitor<'_> for LenientVisitor {
            type Value = Lenient;
            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a string, a number or null")
            }
            fn visit_str<E: de::Error>(self, value: &str) -> Result<Lenient, E> {
                Ok(Lenient(value.to_owned()))
            }
            fn visit_string<E: de::Error>(self, value: String) -> Result<Lenient, E> {
                Ok(Lenient(value))
            }
            fn visit_i64<E: de::Error>(self, value: i64) -> Result<Lenient, E> {
                Ok(Lenient(value.to_string()))
            }
            fn visit_u64<E: de::Error>(self, value: u64) -> Result<Lenient, E> {
                Ok(Lenient(value.to_string()))
            }
            fn visit_f64<E: de::Error>(self, value: f64) -> Result<Lenient, E> {
                Ok(Lenient(value.to_string()))
            }
            fn visit_bool<E: de::Error>(self, _: bool) -> Result<Lenient, E> {
                Ok(Lenient::default())
            }
            fn visit_unit<E: de::Error>(self) -> Result<Lenient, E> {
                Ok(Lenient::default())
            }
            fn visit_none<E: de::Error>(self) -> Result<Lenient, E> {
                Ok(Lenient::default())
            }
        }
        deserializer.deserialize_any(LenientVisitor)
    }
}

#[derive(Default, Deserialize)]
struct Properties {
    #[serde(default)]
    number: Lenient,
    #[serde(default)]
    street: Lenient,
    #[serde(default)]
    unit: Lenient,
    #[serde(default)]
    city: Lenient,
    #[serde(default)]
    postcode: Lenient,
}

#[derive(Deserialize)]
struct Geometry {
    #[serde(default)]
    coordinates: serde_json::Value,
}

#[derive(Deserialize)]
struct Feature {
    #[serde(default)]
    properties: Option<Properties>,
    #[serde(default)]
    geometry: Option<Geometry>,
}

/// Parse and clean one line for `region`. `None` for a line that is not a feature, or a feature that
/// cleaning drops (no number, no street, no point).
pub fn parse_feature_line(line: &str, region: &str) -> Option<Address> {
    let line = line.trim();
    if !line.starts_with('{') {
        return None;
    }
    let feature: Feature = serde_json::from_str(line).ok()?;
    let properties = feature.properties.unwrap_or_default();
    let coordinates = feature.geometry?.coordinates;
    let point = coordinates.as_array()?;
    let longitude = point.first()?.as_f64()?;
    let latitude = point.get(1)?.as_f64()?;
    clean(
        &SourceRow {
            number: &properties.number.0,
            street: &properties.street.0,
            unit: &properties.unit.0,
            city: &properties.city.0,
            postcode: &properties.postcode.0,
            longitude,
            latitude,
        },
        region,
    )
}

/// The two-letter state of a United States source name, uppercase: `us/nc/wake` -> `NC`. `None` for a
/// name outside the United States or without a state segment.
pub fn state_of_source(source: &str) -> Option<String> {
    let mut segments = source.split('/');
    if segments.next()? != "us" {
        return None;
    }
    let state = segments.next()?;
    (state.len() == 2 && state.bytes().all(|byte| byte.is_ascii_alphabetic()))
        .then(|| state.to_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_feature_line_is_parsed_and_cleaned() {
        let line = r#"{"type": "Feature", "properties": {"hash": "04d5", "number": "7634", "street": "Old US 1 Highway", "unit": "Apt 2", "city": "New Hill", "district": "", "region": "", "postcode": "27562-0001", "id": ""}, "geometry": {"type": "Point", "coordinates": [-78.9778003, 35.652707]}}"#;
        let address = parse_feature_line(line, "NC").expect("a usable row");
        assert_eq!(address.number, "7634");
        assert_eq!(address.street, "OLD US 1 HWY");
        assert_eq!(address.unit, "2");
        assert_eq!(address.city, "NEW HILL");
        assert_eq!(address.region, "NC");
        assert_eq!(address.postcode, "27562");
        assert!((address.longitude - -78.9778003).abs() < 1e-9);
    }

    #[test]
    fn numbers_and_nulls_in_properties_are_tolerated() {
        let line = r#"{"properties": {"number": 12, "street": "Main St", "unit": null, "postcode": 27587}, "geometry": {"coordinates": [-78.5, 35.9]}}"#;
        let address = parse_feature_line(line, "NC").expect("a usable row");
        assert_eq!(address.number, "12");
        assert_eq!(address.postcode, "27587");
        assert_eq!(address.unit, "");
    }

    #[test]
    fn unusable_lines_are_skipped() {
        assert!(parse_feature_line("", "NC").is_none());
        assert!(parse_feature_line("not json", "NC").is_none());
        assert!(parse_feature_line("{broken", "NC").is_none());
        let empty = r#"{"properties": {"number": "", "street": ""}, "geometry": {"coordinates": [-83.8, 35.2]}}"#;
        assert!(parse_feature_line(empty, "NC").is_none());
        let polygon = r#"{"properties": {"number": "1", "street": "Main St"}, "geometry": {"coordinates": [[[-83.8, 35.2]]]}}"#;
        assert!(parse_feature_line(polygon, "NC").is_none());
        let no_geometry = r#"{"properties": {"number": "1", "street": "Main St"}}"#;
        assert!(parse_feature_line(no_geometry, "NC").is_none());
    }

    #[test]
    fn the_state_comes_from_the_source_name() {
        assert_eq!(state_of_source("us/nc/wake").as_deref(), Some("NC"));
        assert_eq!(state_of_source("us/pr/statewide").as_deref(), Some("PR"));
        assert_eq!(state_of_source("ca/on/toronto"), None);
        assert_eq!(state_of_source("us/countrywide"), None);
        assert_eq!(state_of_source("us"), None);
    }
}
