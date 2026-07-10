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
}
