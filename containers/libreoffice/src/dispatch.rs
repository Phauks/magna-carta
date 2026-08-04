//! Format-pair dispatch: which conversions this container serves, and the LibreOffice save format
//! and filter each one uses.
//!
//! Dispatch is on the format pair, never on the engine identifier. `x-engine-id` arrives on every
//! request because the convert worker forwards headers verbatim, and it is deliberately not read:
//! that is what lets more than one engine identifier share this container without the container
//! having to know engine identifiers exist.

/// A conversion this container serves, resolved to the exact call the worker will make.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Recipe {
    /// The source format identifier, as the conversion registry names it.
    pub source_format: &'static str,
    /// The file extension the source is written with inside the job package. LibreOffice detects
    /// type by content, but a truthful extension keeps its filter selection unambiguous for the
    /// formats where content detection is weakest (WordPerfect above all).
    pub source_extension: &'static str,
    /// The format token passed to LibreOfficeKit's `save_as`.
    pub save_format: &'static str,
    /// The LibreOffice filter name passed alongside it. Naming the filter explicitly rather than
    /// letting the suite infer one from the extension is what makes the output reproducible.
    pub filter: &'static str,
    /// The extension the output is written with inside the job package.
    pub output_extension: &'static str,
    /// The canonical media type returned as the response `Content-Type`.
    pub media_type: &'static str,
}

const PDF_MEDIA_TYPE: &str = "application/pdf";
const OPEN_DOCUMENT_TEXT_MEDIA_TYPE: &str = "application/vnd.oasis.opendocument.text";

/// Every conversion this container serves. Four edges, exactly the four the conversion registry
/// declares against the `libreoffice` engine — `wpd` to `pdf` is not here because pathfinding
/// already chains it through `odt`, and adding a direct edge would put a special case in the
/// dispatch for a path nobody has measured.
///
/// Spreadsheets and presentations are deliberately absent: a spreadsheet has no intrinsic page
/// geometry, so a converter would be silently deciding print ranges, scaling, and orientation on
/// the firm's behalf. HTML is deliberately absent as a public source too — it is this container's
/// internal intermediate for the email render path, and publishing it would expose an
/// arbitrary-HTML-to-PDF endpoint.
const RECIPES: &[(&str, &str, Recipe)] = &[
    (
        "docx",
        "pdf",
        Recipe {
            source_format: "docx",
            source_extension: "docx",
            save_format: "pdf",
            filter: "writer_pdf_Export",
            output_extension: "pdf",
            media_type: PDF_MEDIA_TYPE,
        },
    ),
    (
        "odt",
        "pdf",
        Recipe {
            source_format: "odt",
            source_extension: "odt",
            save_format: "pdf",
            filter: "writer_pdf_Export",
            output_extension: "pdf",
            media_type: PDF_MEDIA_TYPE,
        },
    ),
    (
        "docx",
        "odt",
        Recipe {
            source_format: "docx",
            source_extension: "docx",
            save_format: "odt",
            filter: "writer8",
            output_extension: "odt",
            media_type: OPEN_DOCUMENT_TEXT_MEDIA_TYPE,
        },
    ),
    (
        "wpd",
        "odt",
        Recipe {
            source_format: "wpd",
            source_extension: "wpd",
            save_format: "odt",
            filter: "writer8",
            output_extension: "odt",
            media_type: OPEN_DOCUMENT_TEXT_MEDIA_TYPE,
        },
    ),
];

/// Resolve a request's format pair and recipe reference to the conversion the worker will run.
///
/// `None` means this container does not serve the request, which the HTTP surface reports as 415.
/// An unknown recipe reference for a pair we otherwise serve is also `None`: the caller asked for
/// something specific, and quietly substituting a different recipe would produce an output that
/// does not match what was requested.
pub fn recipe_for(
    source_format: &str,
    target_format: &str,
    recipe_reference: &str,
) -> Option<Recipe> {
    let recipe = RECIPES
        .iter()
        .find(|(source, target, _)| *source == source_format && *target == target_format)
        .map(|(_, _, recipe)| *recipe)?;
    // Every registry edge names its recipe after the target format; a mismatch means the caller
    // and this table disagree about what the hop does, which is a refusal rather than a guess.
    if recipe_reference != target_format {
        return None;
    }
    Some(recipe)
}

/// Every format pair this container serves, for diagnostics and tests.
pub fn served_pairs() -> impl Iterator<Item = (&'static str, &'static str)> {
    RECIPES.iter().map(|(source, target, _)| (*source, *target))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_four_registered_office_edges_resolve() {
        assert_eq!(
            recipe_for("docx", "pdf", "pdf").map(|r| (r.save_format, r.filter)),
            Some(("pdf", "writer_pdf_Export"))
        );
        assert_eq!(
            recipe_for("odt", "pdf", "pdf").map(|r| (r.save_format, r.filter)),
            Some(("pdf", "writer_pdf_Export"))
        );
        assert_eq!(
            recipe_for("docx", "odt", "odt").map(|r| (r.save_format, r.filter)),
            Some(("odt", "writer8"))
        );
        assert_eq!(
            recipe_for("wpd", "odt", "odt").map(|r| (r.save_format, r.filter)),
            Some(("odt", "writer8"))
        );
    }

    #[test]
    fn word_perfect_to_pdf_is_not_an_edge_here() {
        // Pathfinding chains it through odt; a direct edge would be a second, unmeasured recipe.
        assert_eq!(recipe_for("wpd", "pdf", "pdf"), None);
    }

    #[test]
    fn spreadsheets_presentations_and_html_are_refused() {
        assert_eq!(recipe_for("xlsx", "pdf", "pdf"), None);
        assert_eq!(recipe_for("pptx", "pdf", "pdf"), None);
        assert_eq!(recipe_for("html", "pdf", "pdf"), None);
    }

    #[test]
    fn pdf_is_never_a_source() {
        // LibreOffice imports PDF through Draw and produces a collage of text boxes; declaring the
        // edge would be a fidelity lie told through a data-driven menu.
        assert_eq!(recipe_for("pdf", "docx", "docx"), None);
        assert_eq!(recipe_for("pdf", "odt", "odt"), None);
    }

    #[test]
    fn an_unknown_recipe_reference_is_refused_even_for_a_served_pair() {
        assert_eq!(recipe_for("docx", "pdf", "pdf-a-2b"), None);
        assert_eq!(recipe_for("docx", "pdf", ""), None);
    }

    #[test]
    fn every_recipe_carries_a_canonical_media_type_and_matching_extension() {
        for (_, target, recipe) in RECIPES {
            assert_eq!(recipe.output_extension, *target);
            assert!(!recipe.media_type.is_empty());
            assert!(!recipe.filter.is_empty());
        }
    }

    #[test]
    fn served_pairs_lists_exactly_the_four_edges() {
        let pairs: Vec<_> = served_pairs().collect();
        assert_eq!(
            pairs,
            vec![
                ("docx", "pdf"),
                ("odt", "pdf"),
                ("docx", "odt"),
                ("wpd", "odt")
            ]
        );
    }
}
