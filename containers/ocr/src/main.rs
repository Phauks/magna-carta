//! Thin container entrypoint: load the baked-in models, wrap the work routes in the
//! standard `/ready` probe, body cap, and panic net, then serve on the container's
//! :8080 contract. All logic lives in the library.

use std::path::PathBuf;
use std::sync::Arc;

use ocr_core::engine::{ModelPaths, PaddleRecognizer};

#[tokio::main]
async fn main() -> std::io::Result<()> {
    // Baked into the image by the Dockerfile. Absent models are a deployment fault, not
    // a request fault: fail at boot rather than serve requests that can never succeed.
    let root = PathBuf::from(
        std::env::var("MAGNA_CARTA_OCR_MODELS").unwrap_or_else(|_| "/models".to_string()),
    );
    let model_version = std::env::var("MAGNA_CARTA_OCR_MODEL_VERSION")
        .expect("MAGNA_CARTA_OCR_MODEL_VERSION must name the baked model artifact");
    let recognizer = PaddleRecognizer::load(ModelPaths {
        detection_onnx: root.join("detection/inference.onnx"),
        recognition_onnx: root.join("recognition/inference.onnx"),
        recognition_yaml: root.join("recognition/inference.yml"),
        model_version,
    })
    .expect("the baked-in OCR models must load at boot");

    let state = magna_carta_ocr::AppState {
        recognizer: Arc::new(recognizer),
    };
    let app = engine_host::host::with_panic_net(engine_host::host::ready_app(
        magna_carta_ocr::router(state),
    ));
    engine_host::host::serve(app).await
}
