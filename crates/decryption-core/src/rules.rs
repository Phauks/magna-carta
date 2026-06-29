//! Hashcat rule engine: parses `.rule` files and applies rule operations to words.
//!
//! Supports every operation present in the best64 rule file plus the `l` (lowercase)
//! and `c` (capitalize) operations verified by the module tests.  A rule is a
//! sequence of operations applied left-to-right; an operation that cannot apply
//! (e.g. a required position lies past the end of the current word) causes the
//! whole rule to yield `None` — matching hashcat "reject" semantics — without
//! ever panicking on any word or rule.
//!
//! Position and length arguments use hashcat's base encoding:
//! `'0'`–`'9'` → 0–9, `'A'`–`'Z'` → 10–35.

use std::fmt;

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/// An error produced while parsing a hashcat rule line.
#[derive(Debug, PartialEq)]
pub enum RuleError {
    /// An unrecognised operation character was encountered.
    UnknownOp(char),
    /// An operation expected an argument character but the source string ended.
    MissingArg,
    /// A position or length character was outside the `0-9 A-Z` encoding range.
    InvalidPosition(char),
}

impl fmt::Display for RuleError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownOp(c) => write!(f, "unknown rule operation '{c}'"),
            Self::MissingArg => write!(f, "rule operation is missing an argument character"),
            Self::InvalidPosition(c) => {
                write!(f, "invalid position/length encoding character '{c}'")
            }
        }
    }
}

impl std::error::Error for RuleError {}

// ---------------------------------------------------------------------------
// Position encoding
// ---------------------------------------------------------------------------

/// Decode a hashcat position/length character.
/// `'0'`–`'9'` → 0–9; `'A'`–`'Z'` → 10–35.
fn decode_pos(c: char) -> Option<usize> {
    match c {
        '0'..='9' => Some((c as u8 - b'0') as usize),
        'A'..='Z' => Some((c as u8 - b'A') as usize + 10),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Op
// ---------------------------------------------------------------------------

/// A single hashcat rule operation.
#[derive(Debug, Clone)]
enum Op {
    /// `:` — no-op.
    Noop,
    /// `l` — convert word to lowercase.
    Lowercase,
    /// `u` — convert word to uppercase.
    Uppercase,
    /// `c` — uppercase first char, lowercase the rest.
    Capitalize,
    /// `TN` — toggle case of the char at position N.
    ToggleAt(usize),
    /// `r` — reverse the word.
    Reverse,
    /// `d` — duplicate the word (`pass` → `passpass`).
    Duplicate,
    /// `f` — reflect: append the reversed word (`pass` → `passssap`).
    Reflect,
    /// `{` — rotate left: first char moves to end.
    RotateLeft,
    /// `}` — rotate right: last char moves to front.
    RotateRight,
    /// `]` — remove the last character.
    DeleteLast,
    /// `$X` — append character X.
    AppendChar(char),
    /// `^X` — prepend character X.
    PrependChar(char),
    /// `oNX` — overwrite position N with character X.
    OverwriteAt(usize, char),
    /// `sXY` — replace every occurrence of X with Y.
    Substitute(char, char),
    /// `DN` — delete the character at position N.
    DeleteAt(usize),
    /// `'N` — truncate word to at most N characters.
    TruncateAt(usize),
    /// `+N` — increment (ASCII +1) the character at position N.
    IncrementAt(usize),
    /// `-N` — decrement (ASCII −1) the character at position N.
    DecrementAt(usize),
    /// `ONL` — keep only L characters starting at position N.
    ExtractSubstr(usize, usize),
    /// `YN` — append the last N characters of the word to itself.
    DupLastN(usize),
    /// `ZN` — append N copies of the last character.
    DupLastCharN(usize),
    /// `pN` — append N additional copies of the word.
    DupWordN(usize),
    /// `*XY` — swap the characters at positions X and Y.
    SwapAt(usize, usize),
}

// ---------------------------------------------------------------------------
// Rule
// ---------------------------------------------------------------------------

/// A parsed hashcat rule: an ordered sequence of operations.
#[derive(Debug, Clone)]
pub struct Rule(Vec<Op>);

impl Rule {
    /// Parse a single rule line into a `Rule`.
    ///
    /// Whitespace between operations is ignored, matching the formatting used
    /// in compound rules like `$0 $0` and `] ] ] d`.  Returns `Err` when an
    /// unknown operation character or a missing/malformed argument is found.
    pub fn parse(source: &str) -> Result<Self, RuleError> {
        let mut chars = source.chars().peekable();
        let mut ops: Vec<Op> = Vec::new();

        while let Some(&head) = chars.peek() {
            // Skip whitespace between operations.
            if head == ' ' || head == '\t' {
                chars.next();
                continue;
            }
            chars.next(); // consume the operation character

            let op = match head {
                ':' => Op::Noop,
                'l' => Op::Lowercase,
                'u' => Op::Uppercase,
                'c' => Op::Capitalize,
                'r' => Op::Reverse,
                'd' => Op::Duplicate,
                'f' => Op::Reflect,
                '{' => Op::RotateLeft,
                '}' => Op::RotateRight,
                ']' => Op::DeleteLast,

                '$' => {
                    let x = chars.next().ok_or(RuleError::MissingArg)?;
                    Op::AppendChar(x)
                }
                '^' => {
                    let x = chars.next().ok_or(RuleError::MissingArg)?;
                    Op::PrependChar(x)
                }

                'T' => {
                    let enc = chars.next().ok_or(RuleError::MissingArg)?;
                    let pos = decode_pos(enc).ok_or(RuleError::InvalidPosition(enc))?;
                    Op::ToggleAt(pos)
                }
                'o' => {
                    let enc = chars.next().ok_or(RuleError::MissingArg)?;
                    let pos = decode_pos(enc).ok_or(RuleError::InvalidPosition(enc))?;
                    let x = chars.next().ok_or(RuleError::MissingArg)?;
                    Op::OverwriteAt(pos, x)
                }
                's' => {
                    let from = chars.next().ok_or(RuleError::MissingArg)?;
                    let to = chars.next().ok_or(RuleError::MissingArg)?;
                    Op::Substitute(from, to)
                }
                'D' => {
                    let enc = chars.next().ok_or(RuleError::MissingArg)?;
                    let pos = decode_pos(enc).ok_or(RuleError::InvalidPosition(enc))?;
                    Op::DeleteAt(pos)
                }
                '\'' => {
                    let enc = chars.next().ok_or(RuleError::MissingArg)?;
                    let len = decode_pos(enc).ok_or(RuleError::InvalidPosition(enc))?;
                    Op::TruncateAt(len)
                }
                '+' => {
                    let enc = chars.next().ok_or(RuleError::MissingArg)?;
                    let pos = decode_pos(enc).ok_or(RuleError::InvalidPosition(enc))?;
                    Op::IncrementAt(pos)
                }
                '-' => {
                    let enc = chars.next().ok_or(RuleError::MissingArg)?;
                    let pos = decode_pos(enc).ok_or(RuleError::InvalidPosition(enc))?;
                    Op::DecrementAt(pos)
                }
                'O' => {
                    let p_enc = chars.next().ok_or(RuleError::MissingArg)?;
                    let pos = decode_pos(p_enc).ok_or(RuleError::InvalidPosition(p_enc))?;
                    let l_enc = chars.next().ok_or(RuleError::MissingArg)?;
                    let len = decode_pos(l_enc).ok_or(RuleError::InvalidPosition(l_enc))?;
                    Op::ExtractSubstr(pos, len)
                }
                'Y' => {
                    let enc = chars.next().ok_or(RuleError::MissingArg)?;
                    let n = decode_pos(enc).ok_or(RuleError::InvalidPosition(enc))?;
                    Op::DupLastN(n)
                }
                'Z' => {
                    let enc = chars.next().ok_or(RuleError::MissingArg)?;
                    let n = decode_pos(enc).ok_or(RuleError::InvalidPosition(enc))?;
                    Op::DupLastCharN(n)
                }
                'p' => {
                    let enc = chars.next().ok_or(RuleError::MissingArg)?;
                    let n = decode_pos(enc).ok_or(RuleError::InvalidPosition(enc))?;
                    Op::DupWordN(n)
                }
                '*' => {
                    let x_enc = chars.next().ok_or(RuleError::MissingArg)?;
                    let px = decode_pos(x_enc).ok_or(RuleError::InvalidPosition(x_enc))?;
                    let y_enc = chars.next().ok_or(RuleError::MissingArg)?;
                    let py = decode_pos(y_enc).ok_or(RuleError::InvalidPosition(y_enc))?;
                    Op::SwapAt(px, py)
                }

                other => return Err(RuleError::UnknownOp(other)),
            };

            ops.push(op);
        }

        Ok(Rule(ops))
    }
}

// ---------------------------------------------------------------------------
// RuleSet
// ---------------------------------------------------------------------------

/// A collection of parsed hashcat rules.
pub struct RuleSet(pub Vec<Rule>);

/// Parse a hashcat `.rule` file into a `RuleSet`.
///
/// Blank lines and lines whose first non-whitespace character is `#` are
/// treated as comments and skipped.  Returns the first `RuleError` encountered
/// if any rule line fails to parse.
pub fn parse_rules(text: &str) -> Result<RuleSet, RuleError> {
    let mut rules = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        rules.push(Rule::parse(trimmed)?);
    }
    Ok(RuleSet(rules))
}

// ---------------------------------------------------------------------------
// apply_rule
// ---------------------------------------------------------------------------

/// Apply every operation in `rule` to `word` in sequence, returning the
/// transformed word.  Returns `None` if any operation cannot apply (e.g. a
/// required character position lies past the end of the current word).
///
/// Never panics regardless of the content of `word` or `rule`.
pub fn apply_rule(rule: &Rule, word: &str) -> Option<String> {
    let mut current: String = word.to_owned();
    for op in &rule.0 {
        current = apply_op(op, current)?;
    }
    Some(current)
}

/// Toggle ASCII case; non-ASCII-alphabetic characters pass through unchanged.
#[inline]
fn toggle_case(c: char) -> char {
    if c.is_ascii_uppercase() {
        c.to_ascii_lowercase()
    } else if c.is_ascii_lowercase() {
        c.to_ascii_uppercase()
    } else {
        c
    }
}

fn apply_op(op: &Op, mut word: String) -> Option<String> {
    match op {
        Op::Noop => Some(word),

        Op::Lowercase => Some(word.to_lowercase()),

        Op::Uppercase => Some(word.to_uppercase()),

        Op::Capitalize => {
            let mut iter = word.chars();
            match iter.next() {
                None => Some(String::new()),
                Some(first) => {
                    let tail: String = iter.collect::<String>().to_lowercase();
                    let mut result = first.to_uppercase().collect::<String>();
                    result.push_str(&tail);
                    Some(result)
                }
            }
        }

        Op::ToggleAt(pos) => {
            let mut chars: Vec<char> = word.chars().collect();
            if *pos >= chars.len() {
                return None;
            }
            chars[*pos] = toggle_case(chars[*pos]);
            Some(chars.into_iter().collect())
        }

        Op::Reverse => Some(word.chars().rev().collect()),

        Op::Duplicate => {
            let copy = word.clone();
            word.push_str(&copy);
            Some(word)
        }

        Op::Reflect => {
            let reversed: String = word.chars().rev().collect();
            word.push_str(&reversed);
            Some(word)
        }

        Op::RotateLeft => {
            let chars: Vec<char> = word.chars().collect();
            let len = chars.len();
            if len <= 1 {
                return Some(word);
            }
            let mut result = String::with_capacity(word.len());
            result.extend(chars[1..].iter().copied());
            result.push(chars[0]);
            Some(result)
        }

        Op::RotateRight => {
            let chars: Vec<char> = word.chars().collect();
            let len = chars.len();
            if len <= 1 {
                return Some(word);
            }
            let mut result = String::with_capacity(word.len());
            result.push(chars[len - 1]);
            result.extend(chars[..len - 1].iter().copied());
            Some(result)
        }

        Op::DeleteLast => {
            let chars: Vec<char> = word.chars().collect();
            if chars.is_empty() {
                return None;
            }
            Some(chars[..chars.len() - 1].iter().collect())
        }

        Op::AppendChar(c) => {
            word.push(*c);
            Some(word)
        }

        Op::PrependChar(c) => {
            let mut result = c.to_string();
            result.push_str(&word);
            Some(result)
        }

        Op::OverwriteAt(pos, c) => {
            let mut chars: Vec<char> = word.chars().collect();
            if *pos >= chars.len() {
                return None;
            }
            chars[*pos] = *c;
            Some(chars.into_iter().collect())
        }

        Op::Substitute(from, to) => Some(
            word.chars()
                .map(|c| if c == *from { *to } else { c })
                .collect(),
        ),

        Op::DeleteAt(pos) => {
            let chars: Vec<char> = word.chars().collect();
            if *pos >= chars.len() {
                return None;
            }
            Some(
                chars
                    .into_iter()
                    .enumerate()
                    .filter_map(|(i, c)| if i == *pos { None } else { Some(c) })
                    .collect(),
            )
        }

        Op::TruncateAt(len) => Some(word.chars().take(*len).collect()),

        Op::IncrementAt(pos) => {
            let mut chars: Vec<char> = word.chars().collect();
            if *pos >= chars.len() {
                return None;
            }
            let code = chars[*pos] as u32;
            // Saturate at the Unicode scalar ceiling (U+10FFFF) rather than wrapping.
            chars[*pos] = char::from_u32(code.saturating_add(1)).unwrap_or(chars[*pos]);
            Some(chars.into_iter().collect())
        }

        Op::DecrementAt(pos) => {
            let mut chars: Vec<char> = word.chars().collect();
            if *pos >= chars.len() {
                return None;
            }
            let code = chars[*pos] as u32;
            if code == 0 {
                // Cannot decrement below U+0000; reject the word.
                return None;
            }
            chars[*pos] = char::from_u32(code - 1).unwrap_or(chars[*pos]);
            Some(chars.into_iter().collect())
        }

        Op::ExtractSubstr(pos, len) => {
            let chars: Vec<char> = word.chars().collect();
            // Hashcat rejects when pos >= word length (start at or past the end).
            if *pos >= chars.len() {
                return None;
            }
            let end = (*pos + *len).min(chars.len());
            Some(chars[*pos..end].iter().collect())
        }

        Op::DupLastN(n) => {
            if *n == 0 {
                return Some(word);
            }
            let chars: Vec<char> = word.chars().collect();
            if *n > chars.len() {
                return None;
            }
            let start = chars.len() - *n;
            let suffix: String = chars[start..].iter().collect();
            word.push_str(&suffix);
            Some(word)
        }

        Op::DupLastCharN(n) => {
            if *n == 0 {
                return Some(word);
            }
            let last = word.chars().last()?;
            let extension: String = std::iter::repeat_n(last, *n).collect();
            word.push_str(&extension);
            Some(word)
        }

        Op::DupWordN(n) => {
            if *n == 0 {
                return Some(word);
            }
            // Snapshot the original before the loop modifies `word`.
            let copy = word.clone();
            for _ in 0..*n {
                word.push_str(&copy);
            }
            Some(word)
        }

        Op::SwapAt(x, y) => {
            let mut chars: Vec<char> = word.chars().collect();
            if *x >= chars.len() || *y >= chars.len() {
                return None;
            }
            chars.swap(*x, *y);
            Some(chars.into_iter().collect())
        }
    }
}

// ---------------------------------------------------------------------------
// expand
// ---------------------------------------------------------------------------

/// Transform `word` with every rule in `rules`, yielding one `String` per rule
/// that successfully applies.  Rules that yield `None` are silently skipped.
pub fn expand<'a>(word: &'a str, rules: &'a RuleSet) -> impl Iterator<Item = String> + 'a {
    rules
        .0
        .iter()
        .filter_map(move |rule| apply_rule(rule, word))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_core_ops() {
        assert_eq!(
            apply_rule(&Rule::parse(":").unwrap(), "Pass"),
            Some("Pass".into())
        ); // noop
        assert_eq!(
            apply_rule(&Rule::parse("l").unwrap(), "Pass"),
            Some("pass".into())
        ); // lowercase
        assert_eq!(
            apply_rule(&Rule::parse("u").unwrap(), "Pass"),
            Some("PASS".into())
        ); // uppercase
        assert_eq!(
            apply_rule(&Rule::parse("c").unwrap(), "pass"),
            Some("Pass".into())
        ); // capitalize
        assert_eq!(
            apply_rule(&Rule::parse("$1").unwrap(), "pass"),
            Some("pass1".into())
        ); // append
        assert_eq!(
            apply_rule(&Rule::parse("^!").unwrap(), "pass"),
            Some("!pass".into())
        ); // prepend
        assert_eq!(
            apply_rule(&Rule::parse("r").unwrap(), "pass"),
            Some("ssap".into())
        ); // reverse
        assert_eq!(
            apply_rule(&Rule::parse("d").unwrap(), "pa"),
            Some("papa".into())
        ); // duplicate
        assert_eq!(
            apply_rule(&Rule::parse("$1$2$3").unwrap(), "p"),
            Some("p123".into())
        ); // chained
    }

    #[test]
    fn parses_best64_file_fully() {
        let text = include_str!("../tests/fixtures/best64.rule");
        let set = parse_rules(text).expect("best64 parses");
        assert!(set.0.len() >= 60, "best64 has ~64 rules");
        // Every rule applies to a sample word without panicking.
        for r in &set.0 {
            let _ = apply_rule(r, "Password1");
        }
    }

    /// Correctness vectors for position-based ops, verifying both the happy path
    /// and the reject boundary against hashcat semantics.
    #[test]
    fn position_op_boundary_vectors() {
        // ExtractSubstr (O): pos=0, len=2 on "password" → "pa"
        assert_eq!(
            apply_rule(&Rule::parse("O02").unwrap(), "password"),
            Some("pa".into()),
            "O02 on 'password' extracts chars [0,2)"
        );

        // ExtractSubstr (O): pos=1, len=4 on "ab" — pos(1) < len(2), so
        // accepted; end clamped to len → extracts "b"
        assert_eq!(
            apply_rule(&Rule::parse("O14").unwrap(), "ab"),
            Some("b".into()),
            "O14 on 'ab' clamps extraction to word end"
        );

        // ExtractSubstr (O): pos=1 == len(1) on "a" → reject (None).
        // This is the case the prior `>` condition accepted, emitting Some("").
        assert_eq!(
            apply_rule(&Rule::parse("O11").unwrap(), "a"),
            None,
            "O11 on 'a': pos equals word length → hashcat reject"
        );

        // SwapAt (*): confirmed-correct at boundary — pos 1 is valid in "ab"
        assert_eq!(
            apply_rule(&Rule::parse("*01").unwrap(), "ab"),
            Some("ba".into()),
            "*01 on 'ab' swaps positions 0 and 1"
        );

        // SwapAt (*): pos 1 out of range for a single-char word → reject
        assert_eq!(
            apply_rule(&Rule::parse("*01").unwrap(), "a"),
            None,
            "*01 on 'a': position 1 out of range → reject"
        );

        // DeleteAt (D): pos == last valid index → accepted
        assert_eq!(
            apply_rule(&Rule::parse("D1").unwrap(), "ab"),
            Some("a".into()),
            "D1 on 'ab' deletes the char at position 1"
        );

        // DeleteAt (D): pos == len → reject
        assert_eq!(
            apply_rule(&Rule::parse("D2").unwrap(), "ab"),
            None,
            "D2 on 'ab': position 2 equals word length → reject"
        );
    }
}
