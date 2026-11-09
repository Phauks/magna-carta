# The person-segmentation model

`selfie-segmenter-landscape.onnx` is MediaPipe's **Selfie Segmenter, landscape** (input 144 × 256 RGB,
output a 144 × 256 person mask), converted once from Google's published `.tflite` file to ONNX, the
format the `rten` runtime reads. It is compiled into the WebAssembly module (`src/lib.rs`).

- **Source:** `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite`,
  fetched 2026-11-09, SHA-256 `490e9ea734313e0de10fa0cd9e3c6133e36ea4db2b7a49bde9ef019f72796b8e`.
- **Licence:** Apache-2.0, per MediaPipe's model card for the Selfie Segmentation model.
- **Converted file:** SHA-256 `4cf334b794d471be708a8243b5ca373d6a7581b22baf10b6f8d4a103a5b83047`.

## Why it is converted, and how

`rten` reads ONNX, and no off-the-shelf converter handles this model: its last layer is MediaPipe's own
custom operator `Convolution2DTransposeBias`. `convert-tflite-to-onnx.py` walks the `.tflite` graph and
writes the equivalent ONNX graph operator by operator (convolutions, depthwise convolutions, adds,
multiplies, the activations, the means, the bilinear resizes, and that custom layer as an ONNX
`ConvTranspose` with its bias), turning the float16 weights to float32 and the layout from NHWC to NCHW
inside the graph, with a transpose at each end so the model still takes and answers NHWC.

It is a one-time build input, not part of any build: re-run it only to take a new model release, then
re-run the crate's reference test.

```
python -m venv .venv && .venv/bin/pip install tflite onnx numpy
.venv/bin/python convert-tflite-to-onnx.py selfie_segmenter_landscape.tflite selfie-segmenter-landscape.onnx
```

## How it is checked

`tests/reference.rs` runs the converted model on `tests/fixtures/portrait-256x144.rgb` and compares the
answer with `tests/fixtures/portrait-256x144.mask`, the mask Google's own LiteRT interpreter produced
from the original `.tflite` for the same frame. Every pixel must land on the same side of one half, and
no value may differ by more than the half step the byte-per-pixel reference rounds to. The portrait is
MediaPipe's own test image (`https://storage.googleapis.com/mediapipe-assets/portrait.jpg`, from the
Apache-2.0 MediaPipe project's test assets), resized to 256 × 144.
