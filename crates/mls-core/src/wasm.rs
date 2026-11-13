//! Thin JavaScript marshalling edge, compiled only for wasm32. Nothing is decided here; every failure
//! crosses as its fixed code. Identities and group identifiers cross as strings (they are handles), and
//! handshake messages and keys as bytes.
use wasm_bindgen::prelude::*;

fn code(error: crate::MlsError) -> JsError {
    JsError::new(error.code())
}

/// What a commit produced: the commit for everybody, and the welcome for the people it admits.
#[wasm_bindgen(js_name = MlsCommit)]
pub struct JsCommit {
    commit: Vec<u8>,
    welcome: Option<Vec<u8>>,
}

#[wasm_bindgen(js_class = MlsCommit)]
impl JsCommit {
    #[wasm_bindgen(getter)]
    pub fn commit(&self) -> Vec<u8> {
        self.commit.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn welcome(&self) -> Option<Vec<u8>> {
        self.welcome.clone()
    }
}

/// One participant's side of a meeting's group, as JavaScript sees it.
#[wasm_bindgen(js_name = MlsSession)]
pub struct JsSession {
    inner: crate::Session,
}

#[wasm_bindgen(js_class = MlsSession)]
impl JsSession {
    #[wasm_bindgen(constructor)]
    pub fn new(identity: &str) -> Result<JsSession, JsError> {
        crate::Session::new(identity.as_bytes())
            .map(|inner| JsSession { inner })
            .map_err(code)
    }

    #[wasm_bindgen(js_name = keyPackage)]
    pub fn key_package(&self) -> Result<Vec<u8>, JsError> {
        self.inner.key_package().map_err(code)
    }

    #[wasm_bindgen(js_name = createGroup)]
    pub fn create_group(&mut self, group_id: &str) -> Result<(), JsError> {
        self.inner.create_group(group_id.as_bytes()).map_err(code)
    }

    pub fn join(&mut self, welcome: &[u8], group_id: &str) -> Result<(), JsError> {
        self.inner.join(welcome, group_id.as_bytes()).map_err(code)
    }

    #[wasm_bindgen(js_name = stageAdd)]
    pub fn stage_add(
        &mut self,
        expected_identity: &str,
        key_package: &[u8],
    ) -> Result<(), JsError> {
        self.inner
            .stage_add(expected_identity.as_bytes(), key_package)
            .map_err(code)
    }

    #[wasm_bindgen(js_name = stageRemove)]
    pub fn stage_remove(&mut self, identity: &str) -> Result<(), JsError> {
        self.inner.stage_remove(identity.as_bytes()).map_err(code)
    }

    #[wasm_bindgen(js_name = stagePause)]
    pub fn stage_pause(&mut self, bits: u8) -> Result<(), JsError> {
        self.inner.stage_pause(bits).map_err(code)
    }

    pub fn commit(&mut self) -> Result<JsCommit, JsError> {
        self.inner
            .commit()
            .map(|output| JsCommit {
                commit: output.commit,
                welcome: output.welcome,
            })
            .map_err(code)
    }

    #[wasm_bindgen(js_name = confirmCommit)]
    pub fn confirm_commit(&mut self) -> Result<(), JsError> {
        self.inner.confirm_commit().map_err(code)
    }

    #[wasm_bindgen(js_name = discardCommit)]
    pub fn discard_commit(&mut self) -> Result<(), JsError> {
        self.inner.discard_commit().map_err(code)
    }

    #[wasm_bindgen(js_name = proposePause)]
    pub fn propose_pause(&mut self, bits: u8) -> Result<Vec<u8>, JsError> {
        self.inner.propose_pause(bits).map_err(code)
    }

    /// `committed`, `removed` or `proposed`.
    pub fn process(&mut self, message: &[u8]) -> Result<String, JsError> {
        self.inner
            .process(message)
            .map(|processed| {
                match processed {
                    crate::Processed::Committed => "committed",
                    crate::Processed::Removed => "removed",
                    crate::Processed::Proposed => "proposed",
                }
                .to_string()
            })
            .map_err(code)
    }

    /// The epoch as a JavaScript number: a meeting will not see 2^53 commits.
    pub fn epoch(&self) -> Result<f64, JsError> {
        self.inner.epoch().map(|epoch| epoch as f64).map_err(code)
    }

    #[wasm_bindgen(js_name = ownLeafIndex)]
    pub fn own_leaf_index(&self) -> Result<u32, JsError> {
        self.inner.own_leaf_index().map_err(code)
    }

    /// Every member's leaf index, in order; `memberIdentities` is the same length and order.
    #[wasm_bindgen(js_name = memberLeafIndexes)]
    pub fn member_leaf_indexes(&self) -> Result<Vec<u32>, JsError> {
        self.inner
            .members()
            .map(|members| members.iter().map(|member| member.leaf_index).collect())
            .map_err(code)
    }

    /// Every member's identity, in leaf order. An identity that is not text is refused rather than
    /// shown altered.
    #[wasm_bindgen(js_name = memberIdentities)]
    pub fn member_identities(&self) -> Result<Vec<String>, JsError> {
        let members = self.inner.members().map_err(code)?;
        members
            .into_iter()
            .map(|member| {
                String::from_utf8(member.identity).map_err(|_| code(crate::MlsError::Identity))
            })
            .collect()
    }

    #[wasm_bindgen(js_name = isCommitter)]
    pub fn is_committer(&self, live_identities: Vec<String>) -> Result<bool, JsError> {
        let live: Vec<Vec<u8>> = live_identities
            .into_iter()
            .map(String::into_bytes)
            .collect();
        self.inner.is_committer(&live).map_err(code)
    }

    /// The pause reasons as bits; zero is encrypted.
    pub fn pause(&self) -> Result<u8, JsError> {
        self.inner.pause().map(|pause| pause.bits()).map_err(code)
    }

    #[wasm_bindgen(js_name = sframeBaseKey)]
    pub fn sframe_base_key(&self) -> Result<Vec<u8>, JsError> {
        self.inner.sframe_base_key().map_err(code)
    }

    #[wasm_bindgen(js_name = securityCode)]
    pub fn security_code(&self) -> Result<String, JsError> {
        self.inner.security_code().map_err(code)
    }
}
