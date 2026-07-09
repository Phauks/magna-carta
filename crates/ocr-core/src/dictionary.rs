//! The recognition model's character dictionary lives inside PaddleOCR's
//! `inference.yml`, under `PostProcess.character_dict`. The engine reads it from
//! there rather than from a separate dictionary file: a dictionary that can drift
//! from the model it decodes produces silent, plausible mis-recognition rather
//! than a loud failure.

use crate::OcrError;

/// Extract `PostProcess.character_dict` as newline-delimited text, in file order.
/// Order is load-bearing: the model emits class indices into this list.
pub fn character_dictionary_from_inference_yaml(yaml: &str) -> Result<String, OcrError> {
    let document: serde_yaml_ng::Value =
        serde_yaml_ng::from_str(yaml).map_err(|_| OcrError::ModelDictionaryUnreadable)?;
    let entries = document
        .get("PostProcess")
        .and_then(|post| post.get("character_dict"))
        .and_then(|dict| dict.as_sequence())
        .ok_or(OcrError::ModelDictionaryMissing)?;

    let mut lines = Vec::with_capacity(entries.len());
    for entry in entries {
        // Every entry must be a scalar string. A non-scalar means the file is not the
        // dictionary we think it is, and guessing would shift every class index.
        let glyph = entry.as_str().ok_or(OcrError::ModelDictionaryMissing)?;
        lines.push(glyph);
    }
    if lines.is_empty() {
        return Err(OcrError::ModelDictionaryMissing);
    }
    Ok(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_entries_in_file_order() {
        let yaml = "PostProcess:\n  name: CTCLabelDecode\n  character_dict:\n  - a\n  - b\n  - c\n";
        assert_eq!(
            character_dictionary_from_inference_yaml(yaml).unwrap(),
            "a\nb\nc"
        );
    }

    #[test]
    fn preserves_quoted_entries_including_a_bare_space() {
        // PaddleOCR quotes entries that YAML would otherwise mangle. A space is a real
        // dictionary entry; dropping it shifts every subsequent class index by one.
        let yaml = "PostProcess:\n  character_dict:\n  - 'a'\n  - ' '\n  - '#'\n";
        assert_eq!(
            character_dictionary_from_inference_yaml(yaml).unwrap(),
            "a\n \n#"
        );
    }

    #[test]
    fn preserves_non_latin_entries() {
        let yaml = "PostProcess:\n  character_dict:\n  - 中\n  - あ\n  - Ω\n";
        assert_eq!(
            character_dictionary_from_inference_yaml(yaml).unwrap(),
            "中\nあ\nΩ"
        );
    }

    #[test]
    fn a_missing_dictionary_is_an_error_not_an_empty_string() {
        let yaml = "PostProcess:\n  name: CTCLabelDecode\n";
        let error = character_dictionary_from_inference_yaml(yaml).unwrap_err();
        assert_eq!(error.code(), "model-dictionary-missing");
    }

    #[test]
    fn malformed_yaml_is_an_error() {
        let error = character_dictionary_from_inference_yaml("\t: : :").unwrap_err();
        assert_eq!(error.code(), "model-dictionary-unreadable");
    }
}
