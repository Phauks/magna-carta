//! Scoring recognition against ground truth. Character error rate is the Levenshtein
//! distance between the recognized text and the truth, normalized by the truth's
//! length -- the standard OCR measure, and the one a model upgrade must not regress.

/// Levenshtein edit distance between two character sequences.
pub fn edit_distance(left: &str, right: &str) -> usize {
    let left: Vec<char> = left.chars().collect();
    let right: Vec<char> = right.chars().collect();
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    let mut current = vec![0usize; right.len() + 1];
    for (i, left_char) in left.iter().enumerate() {
        current[0] = i + 1;
        for (j, right_char) in right.iter().enumerate() {
            let substitution = previous[j] + usize::from(left_char != right_char);
            current[j + 1] = substitution.min(previous[j + 1] + 1).min(current[j] + 1);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[right.len()]
}

/// Character error rate: edits per character of ground truth. 0.0 is perfect. A rate
/// above 1.0 is possible when recognition invents more text than exists.
pub fn character_error_rate(truth: &str, recognized: &str) -> f64 {
    let truth_length = truth.chars().count();
    let distance = edit_distance(truth, recognized) as f64;
    if truth_length == 0 {
        // No truth to divide by: every recognized character is spurious.
        return if recognized.is_empty() { 0.0 } else { distance };
    }
    distance / truth_length as f64
}

/// One text unit positioned by a single representative point, ready to be sorted into
/// a canonical reading order. `y` follows the same convention as raster/image
/// coordinates: it increases moving DOWN the page. A caller whose source coordinate
/// space grows upward (PDF user-space points) must flip it before constructing this
/// (e.g. `y = page_height - pdf_y`) -- `reading_order_text` itself does not know which
/// source frame a caller started from, so getting that flip right is the caller's job.
#[derive(Debug, Clone)]
pub struct PositionedText {
    pub text: String,
    pub x: f32,
    pub y: f32,
}

/// Sort `units` into canonical reading order -- top-to-bottom, then left-to-right
/// within a line -- and concatenate them. This is what makes character error rate
/// robust to reading-order noise: ground truth and recognized text are each
/// independently normalized into this same order before being diffed, so a pure
/// reordering (paint order differing from visual line order) no longer shows up as
/// edit distance, and only genuine misreads do.
///
/// Units are grouped into a line by comparing each unit's `y` against the first
/// (smallest-`y`) unit already placed in that line: a difference under
/// `line_tolerance` keeps it on the same line. Comparing against the line's anchor
/// point rather than the previously-seen unit prevents a line from "sliding" --
/// accumulating small per-unit drift into merging with the next line down.
///
/// Within a line, units join with nothing: each unit already carries its own
/// internal text (a glyph run, or a whole recognized line), so inserting a
/// separator would add spacing the source never had. Between lines, a single space
/// joins them: the source paint order carried no separator at a line break, and
/// without one the last unit of one line would glue onto the first unit of the
/// next, inventing a false token that inflates edit distance for no correctness
/// reason. Returns an empty string for empty input; never panics.
pub fn reading_order_text(units: &[PositionedText], line_tolerance: f32) -> String {
    if units.is_empty() {
        return String::new();
    }

    let mut order: Vec<usize> = (0..units.len()).collect();
    order.sort_by(|&a, &b| {
        units[a]
            .y
            .partial_cmp(&units[b].y)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut lines: Vec<Vec<usize>> = Vec::new();
    for index in order {
        let starts_new_line = match lines.last() {
            Some(current) => {
                let anchor_y = units[current[0]].y;
                (units[index].y - anchor_y) >= line_tolerance
            }
            None => true,
        };
        if starts_new_line {
            lines.push(vec![index]);
        } else {
            lines.last_mut().unwrap().push(index);
        }
    }

    lines
        .into_iter()
        .map(|mut line| {
            line.sort_by(|&a, &b| {
                units[a]
                    .x
                    .partial_cmp(&units[b].x)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            line.into_iter()
                .map(|i| units[i].text.as_str())
                .collect::<String>()
        })
        .collect::<Vec<String>>()
        .join(" ")
}

/// The median of `values`, or 0.0 for an empty slice. Used to derive a reading-order
/// line tolerance from the data itself (e.g. the median glyph or line-box height)
/// rather than a fixed constant that would be wrong at a very different font size or
/// render DPI. Does not mutate the caller's slice.
pub fn median(values: &[f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = sorted.len() / 2;
    if sorted.len().is_multiple_of(2) {
        (sorted[mid - 1] + sorted[mid]) / 2.0
    } else {
        sorted[mid]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_text_has_no_error() {
        assert_eq!(character_error_rate("INVOICE", "INVOICE"), 0.0);
    }

    #[test]
    fn one_wrong_character_in_seven_is_one_seventh() {
        let rate = character_error_rate("INVOICE", "1NVOICE");
        assert!((rate - 1.0 / 7.0).abs() < 1e-9, "got {rate}");
    }

    #[test]
    fn edit_distance_counts_insertions_deletions_and_substitutions() {
        assert_eq!(edit_distance("kitten", "sitting"), 3);
        assert_eq!(edit_distance("", "abc"), 3);
        assert_eq!(edit_distance("abc", ""), 3);
    }

    #[test]
    fn empty_truth_with_invented_text_is_a_total_error_not_a_divide_by_zero() {
        assert!(character_error_rate("", "spurious").is_finite());
        assert!(character_error_rate("", "spurious") > 0.0);
    }

    #[test]
    fn multibyte_characters_count_as_one_each() {
        // Byte-length would call this three errors; it is one.
        assert!((character_error_rate("中文", "中x") - 0.5).abs() < 1e-9);
    }

    fn unit(text: &str, x: f32, y: f32) -> PositionedText {
        PositionedText {
            text: text.to_string(),
            x,
            y,
        }
    }

    /// The core proof: three units whose (x, y) positions imply the reading order
    /// ALPHA / BETA / GAMMA top-to-bottom, but which are handed to the function in a
    /// scrambled order. If reading_order_text just concatenated its input, this would
    /// come out "GAMMA ALPHA BETA" -- the spatial normalization is what recovers the
    /// correct order regardless of input order.
    #[test]
    fn reading_order_recovers_scrambled_units() {
        let units = vec![
            unit("GAMMA", 0.0, 20.0),
            unit("ALPHA", 0.0, 0.0),
            unit("BETA", 0.0, 10.0),
        ];
        assert_eq!(reading_order_text(&units, 2.0), "ALPHA BETA GAMMA");
    }

    #[test]
    fn same_line_orders_left_to_right_regardless_of_input_order() {
        let units = vec![unit("WORLD", 10.0, 0.0), unit("HELLO", 0.0, 0.0)];
        assert_eq!(reading_order_text(&units, 2.0), "HELLOWORLD");
    }

    /// Two lines close enough in y to be within tolerance of each other, but far
    /// enough apart that they are clearly two rows, sort top-to-bottom (smaller y
    /// first) -- the convention documented on reading_order_text: y increases moving
    /// down the page, matching raster/image coordinates.
    #[test]
    fn different_lines_order_top_to_bottom_for_the_y_down_convention() {
        let units = vec![unit("SECOND", 0.0, 50.0), unit("FIRST", 0.0, 0.0)];
        assert_eq!(reading_order_text(&units, 5.0), "FIRST SECOND");
    }

    #[test]
    fn single_unit_does_not_panic() {
        let units = vec![unit("ONLY", 5.0, 5.0)];
        assert_eq!(reading_order_text(&units, 2.0), "ONLY");
    }

    #[test]
    fn empty_input_does_not_panic() {
        assert_eq!(reading_order_text(&[], 2.0), "");
    }

    #[test]
    fn median_of_empty_is_zero() {
        assert_eq!(median(&[]), 0.0);
    }

    #[test]
    fn median_of_odd_count_is_the_middle_value() {
        assert_eq!(median(&[3.0, 1.0, 2.0]), 2.0);
    }

    #[test]
    fn median_of_even_count_is_the_mean_of_the_two_middle_values() {
        assert_eq!(median(&[1.0, 2.0, 3.0, 4.0]), 2.5);
    }
}
