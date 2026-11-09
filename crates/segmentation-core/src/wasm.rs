//! Thin JS marshalling edge, compiled only for wasm32. No segmentation logic here; everything
//! delegates to the crate root, and every failure crosses as one fixed code.
use wasm_bindgen::prelude::*;

/// The engine as JavaScript sees it.
#[wasm_bindgen(js_name = Segmenter)]
pub struct JsSegmenter {
    inner: crate::Segmenter,
}

#[wasm_bindgen(js_class = Segmenter)]
impl JsSegmenter {
    /// Load the compiled-in model. Throws `modelUnavailable` on a build fault.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<JsSegmenter, JsError> {
        crate::Segmenter::new()
            .map(|inner| JsSegmenter { inner })
            .map_err(|error| JsError::new(error.code()))
    }

    /// Segment one frame; see [`crate::Segmenter::segment`].
    pub fn segment(&self, rgb: &[f32]) -> Result<Vec<f32>, JsError> {
        self.inner
            .segment(rgb)
            .map_err(|error| JsError::new(error.code()))
    }
}

/// The model's input height, so the caller never hard-codes it.
#[wasm_bindgen(js_name = frameHeight)]
pub fn frame_height() -> usize {
    crate::FRAME_HEIGHT
}

/// The model's input width.
#[wasm_bindgen(js_name = frameWidth)]
pub fn frame_width() -> usize {
    crate::FRAME_WIDTH
}
