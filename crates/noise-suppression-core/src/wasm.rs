//! Thin JS marshalling edge, compiled only for wasm32. Nothing is decided here; every failure crosses as
//! its fixed code.
use wasm_bindgen::prelude::*;

/// The denoiser as JavaScript sees it.
#[wasm_bindgen(js_name = Suppressor)]
pub struct JsSuppressor {
    inner: crate::Suppressor,
}

#[wasm_bindgen(js_class = Suppressor)]
impl JsSuppressor {
    #[wasm_bindgen(constructor)]
    pub fn new() -> JsSuppressor {
        JsSuppressor {
            inner: crate::Suppressor::new(),
        }
    }

    /// Denoise one frame in place of `output`; see [`crate::Suppressor::process`].
    pub fn process(&mut self, input: &[f32], output: &mut [f32]) -> Result<f32, JsError> {
        self.inner
            .process(input, output)
            .map_err(|error| JsError::new(error.code()))
    }
}

impl Default for JsSuppressor {
    fn default() -> Self {
        Self::new()
    }
}

/// Samples in one frame, so the caller never hard-codes it.
#[wasm_bindgen(js_name = frameSamples)]
pub fn frame_samples() -> usize {
    crate::FRAME_SAMPLES
}
