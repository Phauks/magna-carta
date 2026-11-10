//! The WebAssembly edge: the one function a browser or a Worker calls.

use wasm_bindgen::prelude::*;

use crate::{compose_json, FontFamily};

/// A composed document, handed to JavaScript.
#[wasm_bindgen]
pub struct ComposedPdf {
    pdf: Vec<u8>,
    page_count: usize,
    missing_characters: String,
}

#[wasm_bindgen]
impl ComposedPdf {
    /// The file. Takes the bytes out, so a second call returns an empty array.
    #[wasm_bindgen(js_name = takePdf)]
    pub fn take_pdf(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.pdf)
    }

    #[wasm_bindgen(getter, js_name = pageCount)]
    pub fn page_count(&self) -> usize {
        self.page_count
    }

    /// Every character the fonts had no glyph for, as one string in code-point order.
    #[wasm_bindgen(getter, js_name = missingCharacters)]
    pub fn missing_characters(&self) -> String {
        self.missing_characters.clone()
    }
}

/// Compose a document from its JSON form (see `wire.rs`) and the pictures it names by
/// position, in the bundled font family.
#[cfg(feature = "bundled-fonts")]
#[wasm_bindgen(js_name = composeDocument)]
pub fn compose_document(
    document_json: &str,
    images: Vec<js_sys::Uint8Array>,
) -> Result<ComposedPdf, JsError> {
    let images: Vec<Vec<u8>> = images.iter().map(js_sys::Uint8Array::to_vec).collect();
    let borrowed: Vec<&[u8]> = images.iter().map(Vec::as_slice).collect();
    let output = compose_json(document_json, &borrowed, &FontFamily::bundled())
        .map_err(|error| JsError::new(&error.to_string()))?;
    Ok(ComposedPdf {
        pdf: output.pdf,
        page_count: output.page_count,
        missing_characters: output.missing_characters.into_iter().collect(),
    })
}
