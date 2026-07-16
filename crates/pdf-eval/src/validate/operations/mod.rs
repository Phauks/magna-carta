//! Validation-operation plug-ins. Phase 1 ships `forms`; render/redact/scrub/
//! detect/generate/secure/OCR land here on the same `ValidationOperation` trait.

pub mod forms;
pub mod ocr;
pub mod searchable;
pub mod surgery;
