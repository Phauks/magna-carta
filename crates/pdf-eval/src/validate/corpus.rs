//! Forms corpus manifest: parse `corpus-forms.lock` and determine which files are
//! not yet present locally. Fetching (feature `corpus-fetch`) lives at the bottom.

use std::path::Path;

/// One manifest line: a document to fetch and test.
#[derive(Debug, Clone, PartialEq)]
pub struct ManifestEntry {
    pub filename: String,
    pub url: String,
    pub license: String,
}

/// Parse a manifest. Blank lines and `#` comments are ignored. Each data line is
/// `filename  url  license`: the first two whitespace-delimited tokens are the
/// filename and URL; the license is the remainder of the line (it may contain
/// spaces).
pub fn parse_manifest(text: &str) -> Vec<ManifestEntry> {
    let mut entries = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut tokens = line.split_whitespace();
        let (Some(filename), Some(url)) = (tokens.next(), tokens.next()) else {
            continue;
        };
        entries.push(ManifestEntry {
            filename: filename.to_string(),
            url: url.to_string(),
            license: tokens.collect::<Vec<_>>().join(" "),
        });
    }
    entries
}

/// Manifest entries whose file is not present in `dir`.
pub fn missing_documents(entries: &[ManifestEntry], dir: &Path) -> Vec<ManifestEntry> {
    entries
        .iter()
        .filter(|e| !dir.join(&e.filename).exists())
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_data_lines_ignoring_comments() {
        let text = "# header\n\nfoo.pdf  https://x/foo.pdf  Apache-2.0 (a b)\n";
        let entries = parse_manifest(text);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].filename, "foo.pdf");
        assert_eq!(entries[0].url, "https://x/foo.pdf");
        assert_eq!(entries[0].license, "Apache-2.0 (a b)");
    }

    #[test]
    fn committed_manifest_parses() {
        let text = include_str!("../../corpus-forms.lock");
        let entries = parse_manifest(text);
        assert_eq!(entries.len(), 7);
        assert!(entries.iter().all(|e| e.url.starts_with("https://")));
    }
}
