//! The engine against the reference interpreter. The fixtures are one portrait resized to the model's
//! input and the mask Google's own LiteRT interpreter produced for it from the original `.tflite` file
//! (quantized to a byte per pixel), so this test is what proves the ONNX conversion and the runtime
//! together still compute the published model.
// A test reports a failure by panicking; the abort lints exist for the shipped engine, not for this.
#![allow(clippy::panic, clippy::panic_in_result_fn)]
use segmentation_core::{SegmentationError, Segmenter, FRAME_VALUES, MASK_VALUES};

const FRAME: &[u8] = include_bytes!("fixtures/portrait-256x144.rgb");
const REFERENCE: &[u8] = include_bytes!("fixtures/portrait-256x144.mask");

fn frame() -> Vec<f32> {
    FRAME
        .iter()
        .map(|&value| f32::from(value) / 255.0)
        .collect()
}

#[test]
fn matches_the_reference_mask() -> Result<(), SegmentationError> {
    let segmenter = Segmenter::new()?;
    let mask = segmenter.segment(&frame())?;
    assert_eq!(mask.len(), MASK_VALUES);
    assert_eq!(REFERENCE.len(), MASK_VALUES);

    let mut agree = 0usize;
    let mut largest = 0.0f32;
    for (&ours, &theirs) in mask.iter().zip(REFERENCE) {
        let theirs = f32::from(theirs) / 255.0;
        largest = largest.max((ours - theirs).abs());
        if (ours > 0.5) == (theirs > 0.5) {
            agree += 1;
        }
    }
    // The reference is rounded to a byte, so a value can differ by half a step from that alone.
    assert!(
        largest <= 0.5 / 255.0 + 1e-4,
        "largest difference {largest}"
    );
    assert_eq!(
        agree, MASK_VALUES,
        "every pixel on the same side of one half"
    );
    Ok(())
}

#[test]
fn finds_a_person_in_the_portrait() -> Result<(), SegmentationError> {
    let mask = Segmenter::new()?.segment(&frame())?;
    let person = mask.iter().filter(|&&value| value > 0.5).count();
    // About half the frame is the subject; a model that answered all-room or all-person fails here.
    assert!(person > MASK_VALUES / 4 && person < MASK_VALUES * 3 / 4);
    Ok(())
}

#[test]
fn refuses_a_frame_of_the_wrong_size() -> Result<(), SegmentationError> {
    let segmenter = Segmenter::new()?;
    assert_eq!(
        segmenter.segment(&vec![0.0; FRAME_VALUES - 1]),
        Err(SegmentationError::FrameSize)
    );
    assert_eq!(segmenter.segment(&[]), Err(SegmentationError::FrameSize));
    Ok(())
}
