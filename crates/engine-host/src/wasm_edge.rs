//! The wasm32 JS-marshalling edge toolkit: stable error codes (never file
//! content), bytes->Uint8Array, and an object builder. The trait + code guard
//! compile everywhere and are tested natively; the js_sys glue is wasm-only.

/// The stable-error-code contract for the wasm edge. A `&'static str` code is
/// chosen from a fixed set per engine, so it can never carry dynamic file bytes
/// — the privileged-content rule, enforced by construction.
pub trait EdgeError {
    fn code(&self) -> &'static str;
}

/// Guard that an emitted code is one of an engine's declared fixed codes. Engines
/// call this in a test to prove their error mapping never leaks an ad-hoc string.
pub fn allowed_code(code: &str, allowed: &[&str]) -> bool {
    allowed.contains(&code)
}

#[cfg(test)]
mod tests {
    use super::*;

    enum SampleError {
        WrongPassword,
        Malformed,
    }

    impl EdgeError for SampleError {
        fn code(&self) -> &'static str {
            match self {
                SampleError::WrongPassword => "wrongPassword",
                SampleError::Malformed => "malformed",
            }
        }
    }

    const ALLOWED: &[&str] = &["wrongPassword", "malformed"];

    #[test]
    fn error_code_is_a_fixed_static_string() {
        assert_eq!(SampleError::WrongPassword.code(), "wrongPassword");
        assert!(allowed_code(SampleError::Malformed.code(), ALLOWED));
    }

    #[test]
    fn an_unlisted_code_is_rejected_by_the_guard() {
        // A would-be content-bearing string is not in the fixed set.
        assert!(!allowed_code("secret-client-name.docx", ALLOWED));
    }
}

#[cfg(target_arch = "wasm32")]
mod glue {
    use super::EdgeError;
    use wasm_bindgen::prelude::*;

    /// Copy a byte slice into a JS `Uint8Array` for return across the edge.
    pub fn bytes_out(bytes: &[u8]) -> js_sys::Uint8Array {
        js_sys::Uint8Array::from(bytes)
    }

    /// Map an engine error to a `JsError` carrying only its stable code.
    pub fn to_js_error<E: EdgeError>(error: &E) -> JsError {
        JsError::new(error.code())
    }

    /// Builder over `js_sys::Object` + `Reflect::set` — the pattern both engines'
    /// `wasm.rs` files re-implement.
    pub struct ObjectBuilder {
        object: js_sys::Object,
    }

    impl ObjectBuilder {
        pub fn new() -> Self {
            Self {
                object: js_sys::Object::new(),
            }
        }

        pub fn set(self, key: &str, value: &JsValue) -> Self {
            let result = js_sys::Reflect::set(&self.object, &JsValue::from_str(key), value);
            debug_assert!(result.is_ok());
            self
        }

        pub fn into_value(self) -> JsValue {
            self.object.into()
        }
    }

    impl Default for ObjectBuilder {
        fn default() -> Self {
            Self::new()
        }
    }
}

#[cfg(target_arch = "wasm32")]
pub use glue::{bytes_out, to_js_error, ObjectBuilder};

#[cfg(target_arch = "wasm32")]
#[cfg(test)]
mod wasm_tests {
    use super::*;
    use wasm_bindgen::JsCast;
    use wasm_bindgen::JsValue;
    use wasm_bindgen_test::*;

    // Minimal error type for wasm-boundary tests — satisfies the `EdgeError`
    // contract without pulling in the native-only `SampleError`.
    struct WrongPasswordError;

    impl EdgeError for WrongPasswordError {
        fn code(&self) -> &'static str {
            "wrongPassword"
        }
    }

    #[wasm_bindgen_test]
    fn to_js_error_emits_stable_code_as_message() {
        let e = WrongPasswordError;
        let js_val: JsValue = to_js_error(&e).into();
        let err: js_sys::Error = js_val.dyn_into().unwrap();
        assert_eq!(String::from(err.message()), "wrongPassword");
    }

    #[wasm_bindgen_test]
    fn bytes_out_roundtrips_length() {
        let arr = bytes_out(&[1, 2, 3]);
        assert_eq!(arr.length(), 3);
        assert_eq!(arr.to_vec(), vec![1u8, 2, 3]);
    }

    #[wasm_bindgen_test]
    fn object_builder_sets_a_key() {
        let value = ObjectBuilder::new()
            .set("ok", &JsValue::from_bool(true))
            .into_value();
        let got = js_sys::Reflect::get(&value, &JsValue::from_str("ok")).unwrap();
        assert_eq!(got.as_bool(), Some(true));
    }
}
