//! The passage chunker: one page of text becomes one passage.
//!
//! This rule used to live in TypeScript, in `packages/search/src/extraction.ts`, where only the
//! server could run it. It lives here now because passages are what get indexed and what get hashed,
//! so a desktop that chunked differently from the server would build an index that disagrees with
//! the server's about what a document says. Moving it to the shared core is what makes "the same
//! bytes produce the same passages wherever they are read" a property rather than a hope.
//!
//! The rule itself is unchanged, deliberately and byte-for-byte:
//!
//! - A page is the chunk boundary. The semantic half embeds per passage and a hit carries its page
//!   back for display, so keyword and semantic halves stay on the same units with no second rule.
//! - A page's lines are trimmed, the empty ones dropped, and the rest joined with a line feed.
//! - A page whose lines are all empty contributes NOTHING — not an empty passage — so a blank page
//!   never becomes a document the index has to carry.
//! - `chunk_id` is `page-<zero-based index>` and `page` is the one-based page a person would name.

/// One page of text, as an extractor produces it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Page {
    /// Zero-based, as the engines report it.
    pub page_index: usize,
    pub lines: Vec<String>,
}

/// One indexable passage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Passage {
    pub chunk_id: String,
    pub text: String,
    /// One-based — the page number a person would say out loud.
    pub page: usize,
}

/// Turn pages into passages. Pages arrive in whatever order the routes produced them and leave in
/// page order, because a passage list whose order depends on which route answered first would make
/// the derived split depend on scheduling.
pub fn passages_from_pages(pages: &[Page]) -> Vec<Passage> {
    let mut ordered: Vec<&Page> = pages.iter().collect();
    ordered.sort_by_key(|page| page.page_index);
    let mut passages = Vec::new();
    for page in ordered {
        let text = page
            .lines
            .iter()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty())
            .collect::<Vec<&str>>()
            .join("\n");
        if text.is_empty() {
            continue;
        }
        passages.push(Passage {
            chunk_id: format!("page-{}", page.page_index),
            text,
            page: page.page_index + 1,
        });
    }
    passages
}

/// The whole document's text, as one string, for hashing and fingerprinting. Pages are joined with a
/// single line feed so the concatenation carries no separator a page's own text could also contain.
pub fn document_text(passages: &[Passage]) -> String {
    passages
        .iter()
        .map(|passage| passage.text.as_str())
        .collect::<Vec<&str>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(index: usize, lines: &[&str]) -> Page {
        Page {
            page_index: index,
            lines: lines.iter().map(|line| (*line).to_owned()).collect(),
        }
    }

    /// The corpus the TypeScript chunker's own tests pin, asserted against this implementation. The
    /// expected values are copied from that suite rather than derived here, so a divergence between
    /// the two implementations fails rather than agreeing with itself.
    #[test]
    fn the_typescript_chunkers_corpus_produces_identical_output() {
        let passages = passages_from_pages(&[
            page(0, &["the seller shall", "indemnify the buyer"]),
            page(1, &["environmental liability"]),
        ]);
        assert_eq!(
            passages,
            vec![
                Passage {
                    chunk_id: "page-0".to_owned(),
                    text: "the seller shall\nindemnify the buyer".to_owned(),
                    page: 1,
                },
                Passage {
                    chunk_id: "page-1".to_owned(),
                    text: "environmental liability".to_owned(),
                    page: 2,
                },
            ]
        );

        let sparse =
            passages_from_pages(&[page(0, &[]), page(1, &["   "]), page(2, &["real text"])]);
        assert_eq!(
            sparse
                .iter()
                .map(|passage| passage.chunk_id.as_str())
                .collect::<Vec<&str>>(),
            vec!["page-2"]
        );

        assert!(passages_from_pages(&[page(0, &[""])]).is_empty());
    }

    #[test]
    fn pages_leave_in_page_order_however_they_arrived() {
        let passages = passages_from_pages(&[page(2, &["third"]), page(0, &["first"])]);
        assert_eq!(
            passages
                .iter()
                .map(|passage| passage.page)
                .collect::<Vec<usize>>(),
            vec![1, 3]
        );
    }

    #[test]
    fn a_document_with_no_readable_text_yields_no_passages_at_all() {
        assert!(passages_from_pages(&[page(0, &["", "  ", "\t"])]).is_empty());
    }

    #[test]
    fn the_document_text_is_the_passages_joined_and_nothing_else() {
        let passages = passages_from_pages(&[page(0, &["one"]), page(1, &["two"])]);
        assert_eq!(document_text(&passages), "one\ntwo");
    }
}
