//! Person segmentation for a meeting's camera: one small RGB frame in, one mask out, saying for each
//! pixel how likely it is to be the person rather than the room behind them.
//!
//! The browser blurs or replaces the background with that mask; nothing here touches the full-size
//! frame, the network or storage. The model is MediaPipe's landscape selfie segmenter, converted once
//! to ONNX (see `model/README.md`) and compiled into the module, so loading the engine is one fetch.
//!
//! Every failure is one of the fixed codes in [`SegmentationError`]. A frame is the member's own
//! camera, so none of this reads anybody else's bytes, but the lint floor applies all the same: no
//! unsafe code, and no input can abort the module.

#[cfg(target_arch = "wasm32")]
mod wasm;

use rten::Model;
use rten_tensor::prelude::*;
use rten_tensor::{NdTensor, Tensor};

/// The model's fixed input height, in pixels.
pub const FRAME_HEIGHT: usize = 144;
/// The model's fixed input width, in pixels. Landscape, matching a laptop camera.
pub const FRAME_WIDTH: usize = 256;
/// Values in one RGB frame: height × width × three channels.
pub const FRAME_VALUES: usize = FRAME_HEIGHT * FRAME_WIDTH * 3;
/// Values in one mask: one per pixel.
pub const MASK_VALUES: usize = FRAME_HEIGHT * FRAME_WIDTH;

const MODEL: &[u8] = include_bytes!("../model/selfie-segmenter-landscape.onnx");

/// Why a segmentation did not happen. Codes only: nothing here carries frame content.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SegmentationError {
    /// The compiled-in model did not load. A build fault, never an input fault.
    #[error("modelUnavailable")]
    ModelUnavailable,
    /// The frame was not exactly [`FRAME_VALUES`] values.
    #[error("frameSize")]
    FrameSize,
    /// The runtime refused the frame or answered in an unexpected shape.
    #[error("inferenceFailed")]
    InferenceFailed,
}

impl SegmentationError {
    /// The stable code a caller reports.
    pub fn code(&self) -> &'static str {
        match self {
            Self::ModelUnavailable => "modelUnavailable",
            Self::FrameSize => "frameSize",
            Self::InferenceFailed => "inferenceFailed",
        }
    }
}

/// A loaded segmenter. Build one when the member turns an effect on and reuse it for every frame;
/// loading plans the whole graph and is the expensive part.
pub struct Segmenter {
    model: Model,
}

impl Segmenter {
    /// Load the compiled-in model.
    pub fn new() -> Result<Self, SegmentationError> {
        let model = Model::load(MODEL.to_vec()).map_err(|_| SegmentationError::ModelUnavailable)?;
        Ok(Self { model })
    }

    /// Segment one frame: [`FRAME_HEIGHT`] rows of [`FRAME_WIDTH`] pixels, each red, green and blue in
    /// 0.0–1.0, row-major. Answers [`MASK_VALUES`] values in 0.0–1.0, 1.0 being the person.
    pub fn segment(&self, rgb: &[f32]) -> Result<Vec<f32>, SegmentationError> {
        if rgb.len() != FRAME_VALUES {
            return Err(SegmentationError::FrameSize);
        }
        let input = NdTensor::from_data([1, FRAME_HEIGHT, FRAME_WIDTH, 3], rgb.to_vec());
        let output: Tensor<f32> = self
            .model
            .run_one(input.into(), None)
            .map_err(|_| SegmentationError::InferenceFailed)?
            .try_into()
            .map_err(|_| SegmentationError::InferenceFailed)?;
        let mask = output.to_vec();
        if mask.len() != MASK_VALUES {
            return Err(SegmentationError::InferenceFailed);
        }
        Ok(mask)
    }
}
