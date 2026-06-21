use hayro::hayro_syntax::Pdf;

/// What a PDF operation can fail at. No logging here — the caller owns that.
#[derive(Debug, PartialEq, Eq)]
pub enum PdfError {
    Parse,
    PageOutOfRange,
    Render,
}

/// A parsed PDF held in memory.
pub struct Document {
    pdf: Pdf,
}

impl Document {
    pub fn load(bytes: Vec<u8>) -> Result<Self, PdfError> {
        Pdf::new(bytes)
            .map(|pdf| Document { pdf })
            .map_err(|_| PdfError::Parse)
    }

    pub fn page_count(&self) -> usize {
        self.pdf.pages().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank() -> Vec<u8> {
        include_bytes!("../tests/fixtures/blank.pdf").to_vec()
    }

    #[test]
    fn loads_and_counts_one_page() {
        let doc = Document::load(blank()).expect("loads");
        assert_eq!(doc.page_count(), 1);
    }

    #[test]
    fn rejects_garbage() {
        assert!(matches!(
            Document::load(b"not a pdf".to_vec()),
            Err(PdfError::Parse)
        ));
    }
}
