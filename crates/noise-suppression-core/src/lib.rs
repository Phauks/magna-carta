//! Background noise taken out of a meeting microphone: 10 ms of 48 kHz mono audio in, the same 10 ms
//! with the speech kept and the fan, the keyboard and the street taken out, and how likely the frame
//! was to hold a voice.
//!
//! The denoiser is `nnnoiseless`, a pure-Rust port of RNNoise: a small recurrent network over the
//! spectrum's bands, trained weights compiled in, no native code anywhere in its tree. It runs in the
//! member's browser, in an audio worklet, so the audio never leaves their machine to be cleaned.

#[cfg(target_arch = "wasm32")]
mod wasm;

use nnnoiseless::DenoiseState;

/// Samples in one frame: 10 ms at 48 kHz, the only rate and length the network was trained on.
pub const FRAME_SAMPLES: usize = DenoiseState::FRAME_SIZE;

/// The sample rate every frame is at.
pub const SAMPLE_RATE: u32 = 48_000;

/// The network works on 16-bit sample values held as floats; the browser hands audio in [-1, 1].
const SAMPLE_SCALE: f32 = 32_768.0;

/// Why a frame was refused. Each crosses to JavaScript as its code alone.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SuppressionError {
    /// A frame that is not exactly [`FRAME_SAMPLES`] long, in or out.
    #[error("frameLength")]
    FrameLength,
}

impl SuppressionError {
    /// The fixed code that crosses the WebAssembly edge.
    pub fn code(&self) -> &'static str {
        match self {
            SuppressionError::FrameLength => "frameLength",
        }
    }
}

/// One microphone's denoiser. It carries state from frame to frame (the network is recurrent and the
/// spectrum overlaps), so one belongs to one stream and frames go through it in order.
pub struct Suppressor {
    state: Box<DenoiseState<'static>>,
    scaled_in: Vec<f32>,
    scaled_out: Vec<f32>,
}

impl Default for Suppressor {
    fn default() -> Self {
        Self::new()
    }
}

impl Suppressor {
    pub fn new() -> Self {
        Suppressor {
            state: DenoiseState::new(),
            scaled_in: vec![0.0; FRAME_SAMPLES],
            scaled_out: vec![0.0; FRAME_SAMPLES],
        }
    }

    /// Denoise one frame of samples in [-1, 1] into `output`, and answer the probability, from 0 to 1,
    /// that the frame held a voice. The output is clamped to [-1, 1], because the network can overshoot
    /// on a loud transient and a browser plays an out-of-range sample as a click.
    pub fn process(&mut self, input: &[f32], output: &mut [f32]) -> Result<f32, SuppressionError> {
        if input.len() != FRAME_SAMPLES || output.len() != FRAME_SAMPLES {
            return Err(SuppressionError::FrameLength);
        }
        for (scaled, sample) in self.scaled_in.iter_mut().zip(input) {
            *scaled = if sample.is_finite() {
                sample.clamp(-1.0, 1.0) * SAMPLE_SCALE
            } else {
                0.0
            };
        }
        let voice = self
            .state
            .process_frame(&mut self.scaled_out, &self.scaled_in);
        for (sample, scaled) in output.iter_mut().zip(&self.scaled_out) {
            *sample = (scaled / SAMPLE_SCALE).clamp(-1.0, 1.0);
        }
        Ok(if voice.is_finite() {
            voice.clamp(0.0, 1.0)
        } else {
            0.0
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(frequency: f32, amplitude: f32, offset: usize) -> Vec<f32> {
        (0..FRAME_SAMPLES)
            .map(|index| {
                let time = (offset + index) as f32 / SAMPLE_RATE as f32;
                amplitude * (2.0 * std::f32::consts::PI * frequency * time).sin()
            })
            .collect()
    }

    fn energy(samples: &[f32]) -> f32 {
        samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32
    }

    #[test]
    fn refuses_a_frame_of_the_wrong_length() {
        let mut suppressor = Suppressor::new();
        let mut output = vec![0.0; FRAME_SAMPLES];
        assert_eq!(
            suppressor.process(&[0.0; 10], &mut output),
            Err(SuppressionError::FrameLength)
        );
        let mut short = vec![0.0; 10];
        assert_eq!(
            suppressor.process(&vec![0.0; FRAME_SAMPLES], &mut short),
            Err(SuppressionError::FrameLength)
        );
    }

    #[test]
    fn keeps_silence_silent_and_reads_no_voice_in_it() {
        let mut suppressor = Suppressor::new();
        let mut output = vec![1.0; FRAME_SAMPLES];
        let voice = suppressor
            .process(&vec![0.0; FRAME_SAMPLES], &mut output)
            .expect("a frame of the right length");
        assert!(energy(&output) < 1e-9);
        assert!(voice < 0.5);
    }

    /// Low, steady noise (white noise from a fixed linear congruential sequence, then smoothed), the
    /// shape of a fan, an air conditioner or a road outside. Fixed, so the test is the same every run.
    fn rumble(state: &mut u32, smoothed: &mut f32, amplitude: f32) -> Vec<f32> {
        (0..FRAME_SAMPLES)
            .map(|_| {
                *state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let white = (*state >> 8) as f32 / (1u32 << 24) as f32 * 2.0 - 1.0;
                *smoothed = 0.95 * *smoothed + 0.05 * white;
                amplitude * *smoothed * 6.0
            })
            .collect()
    }

    #[test]
    fn takes_a_steady_rumble_out_at_every_level() {
        // No voice in it, so once the network has heard a few seconds of it, almost none should pass,
        // whether the room is quiet or loud.
        for amplitude in [0.003, 0.01, 0.03, 0.1] {
            let mut suppressor = Suppressor::new();
            let mut output = vec![0.0; FRAME_SAMPLES];
            let (mut state, mut smoothed) = (7, 0.0);
            let mut kept = 0.0;
            let mut heard = 0.0;
            for frame in 0..400 {
                let input = rumble(&mut state, &mut smoothed, amplitude);
                suppressor
                    .process(&input, &mut output)
                    .expect("a frame of the right length");
                if frame >= 200 {
                    kept += energy(&output);
                    heard += energy(&input);
                }
            }
            assert!(
                kept < heard * 0.05,
                "at {amplitude}, kept {kept} of {heard}"
            );
        }
    }

    #[test]
    fn lets_a_voiced_sound_through_far_more_than_hiss() {
        // A harmonic tone is the shape the network keeps; it must not be treated like the hiss.
        let mut suppressor = Suppressor::new();
        let mut output = vec![0.0; FRAME_SAMPLES];
        let mut kept = 0.0;
        let mut heard = 0.0;
        for frame in 0..200 {
            let input = tone(120.0, 0.1, frame * FRAME_SAMPLES);
            suppressor
                .process(&input, &mut output)
                .expect("a frame of the right length");
            if frame >= 100 {
                kept += energy(&output);
                heard += energy(&input);
            }
        }
        assert!(kept > heard * 0.5, "kept {kept} of {heard}");
    }

    #[test]
    fn answers_in_range_whatever_it_is_given() {
        let mut suppressor = Suppressor::new();
        let mut output = vec![0.0; FRAME_SAMPLES];
        let mut input = vec![4.0; FRAME_SAMPLES];
        if let Some(first) = input.first_mut() {
            *first = f32::NAN;
        }
        let voice = suppressor
            .process(&input, &mut output)
            .expect("a frame of the right length");
        assert!((0.0..=1.0).contains(&voice));
        assert!(output.iter().all(|sample| (-1.0..=1.0).contains(sample)));
    }
}
