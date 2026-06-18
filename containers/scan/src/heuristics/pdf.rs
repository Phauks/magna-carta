use super::Heuristic;
use lopdf::{Document, Object};

/// Inspects a PDF for active content (JavaScript, auto-actions, launch actions, embedded files) or
/// password-encryption that blocks inspection. `load_mem` auto-decrypts empty-password PDFs (the common
/// owner-restricted case), so only a genuinely password-locked PDF — a load error naming a password /
/// unsupported security handler — is `Encrypted`. An otherwise-unparseable PDF is `Clean` here (clamd
/// and yara still scan the bytes).
pub fn inspect_pdf(bytes: &[u8]) -> Heuristic {
    let doc = match Document::load_mem(bytes) {
        Ok(doc) => doc,
        Err(lopdf::Error::InvalidPassword) | Err(lopdf::Error::UnsupportedSecurityHandler(_)) => {
            return Heuristic::Encrypted;
        }
        Err(_) => return Heuristic::Clean,
    };
    if has_active_content(&doc) {
        Heuristic::ActiveContent
    } else {
        Heuristic::Clean
    }
}

// PDF dictionary keys and name values are byte strings, not text — match with byte literals. Active
// content surfaces as a dictionary KEY (/OpenAction, /AA auto-actions; /JavaScript, /JS) or as a name
// VALUE (/S /Launch; /Type /EmbeddedFile). Stream objects carry a dictionary too (/JS, /EmbeddedFile
// payloads are streams), so descend into those.
fn has_active_content(doc: &Document) -> bool {
    for object in doc.objects.values() {
        let dict = match object {
            Object::Dictionary(dictionary) => dictionary,
            Object::Stream(stream) => &stream.dict,
            _ => continue,
        };
        if dict.has(b"OpenAction") || dict.has(b"AA") || dict.has(b"JavaScript") || dict.has(b"JS")
        {
            return true;
        }
        let has_launch_or_embedded = dict.iter().any(|(_key, value)| {
            value
                .as_name()
                .map(|name| name == b"Launch" || name == b"EmbeddedFile")
                .unwrap_or(false)
        });
        if has_launch_or_embedded {
            return true;
        }
    }
    false
}
