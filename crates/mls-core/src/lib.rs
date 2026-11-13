//! Group key agreement for an end-to-end encrypted meeting: one MLS group (RFC 9420) per meeting, held in
//! each participant's browser, whose per-epoch exporter secret becomes the SFrame base key (RFC 9605,
//! section 5.2) that the frame transform derives its per-sender keys from.
//!
//! This crate decides nothing about WHO may be in the group. The meeting's signaling room says who has
//! been let in and who has gone; the browser that commits checks each key package against the stay the
//! room says sent it, and every browser checks what it is handed against the group state it has verified
//! itself. What the room can never do is read a key: it relays handshake messages, in order, and stores
//! none of them.
//!
//! Every failure crosses the boundary as one of the fixed codes in [`MlsError::code`]. Nothing in a code
//! carries key material, a credential or a message.

use openmls::prelude::tls_codec::{Deserialize, Serialize};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::types::HashType;
use openmls_traits::OpenMlsProvider;

#[cfg(target_arch = "wasm32")]
mod wasm;

/// X25519 for the tree, AES-128-GCM for the handshake, SHA-256, Ed25519 credentials: the one suite
/// every browser runs, and the one whose AEAD matches the SFrame suite the frames use.
pub const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

/// The exporter label RFC 9605 names for an MLS-keyed SFrame session.
pub const SFRAME_EXPORTER_LABEL: &str = "SFrame 1.0 Base Key";

/// AES-128-GCM's key length: the length of the SFrame base key the exporter yields.
pub const SFRAME_BASE_KEY_LENGTH: usize = 16;

/// The group context extension that says the meeting is not end-to-end encrypted right now, and why. It
/// is in the private-use range RFC 9420 sets aside (0xF000 to 0xFFFF). Its body is one byte of
/// [`PauseReasons`] bits; absent, or zero, means encrypted.
pub const PAUSE_EXTENSION_TYPE: u16 = 0xF0E1;

/// The longest identity a credential may carry. An identity is a stay's handle, which is far shorter.
pub const IDENTITY_MAXIMUM_LENGTH: usize = 128;

/// The longest group identifier: a meeting's handle, which is far shorter.
pub const GROUP_ID_MAXIMUM_LENGTH: usize = 128;

/// Digit groups in the security code, and digits in each.
pub const SECURITY_CODE_GROUPS: usize = 6;
pub const SECURITY_CODE_GROUP_DIGITS: usize = 5;

/// Why encryption is paused: the server can hear the meeting while any of these runs. A set of bits,
/// because two can run at once and encryption resumes only when the last one stops.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PauseReasons(u8);

impl PauseReasons {
    pub const RECORDING: u8 = 0b001;
    pub const CAPTIONS: u8 = 0b010;
    pub const PHONE: u8 = 0b100;
    const ALL: u8 = Self::RECORDING | Self::CAPTIONS | Self::PHONE;

    /// The set from its bits, refusing a bit no reason owns.
    pub fn from_bits(bits: u8) -> Result<Self, MlsError> {
        if bits & !Self::ALL != 0 {
            return Err(MlsError::PauseReason);
        }
        Ok(Self(bits))
    }

    pub fn bits(self) -> u8 {
        self.0
    }

    pub fn is_paused(self) -> bool {
        self.0 != 0
    }
}

/// Every way an act can be refused. The code is what crosses to JavaScript.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum MlsError {
    #[error("identity")]
    Identity,
    #[error("groupId")]
    GroupId,
    #[error("keyPackage")]
    KeyPackage,
    #[error("identityMismatch")]
    IdentityMismatch,
    #[error("alreadyInGroup")]
    AlreadyInGroup,
    #[error("notInGroup")]
    NotInGroup,
    #[error("unknownMember")]
    UnknownMember,
    #[error("pauseReason")]
    PauseReason,
    #[error("pendingCommit")]
    PendingCommit,
    #[error("noPendingCommit")]
    NoPendingCommit,
    #[error("nothingToCommit")]
    NothingToCommit,
    #[error("malformed")]
    Malformed,
    #[error("wrongGroup")]
    WrongGroup,
    #[error("wrongEpoch")]
    WrongEpoch,
    #[error("refused")]
    Refused,
    #[error("engineFailed")]
    EngineFailed,
}

impl MlsError {
    /// The fixed code for this refusal.
    pub fn code(&self) -> &'static str {
        match self {
            MlsError::Identity => "identity",
            MlsError::GroupId => "groupId",
            MlsError::KeyPackage => "keyPackage",
            MlsError::IdentityMismatch => "identityMismatch",
            MlsError::AlreadyInGroup => "alreadyInGroup",
            MlsError::NotInGroup => "notInGroup",
            MlsError::UnknownMember => "unknownMember",
            MlsError::PauseReason => "pauseReason",
            MlsError::PendingCommit => "pendingCommit",
            MlsError::NoPendingCommit => "noPendingCommit",
            MlsError::NothingToCommit => "nothingToCommit",
            MlsError::Malformed => "malformed",
            MlsError::WrongGroup => "wrongGroup",
            MlsError::WrongEpoch => "wrongEpoch",
            MlsError::Refused => "refused",
            MlsError::EngineFailed => "engineFailed",
        }
    }
}

/// An engine failure that is not the caller's to fix. Its detail is dropped on purpose: OpenMLS's own
/// messages can name what was being processed.
fn engine<E>(_: E) -> MlsError {
    MlsError::EngineFailed
}

/// What a commit produced, for the room to deliver: the commit to every member, and the welcome to the
/// people it admits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitOutput {
    pub commit: Vec<u8>,
    pub welcome: Option<Vec<u8>>,
}

/// What processing a handshake message did to this participant's group.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Processed {
    /// A commit was applied; the group is at a new epoch with new keys.
    Committed,
    /// A commit removed this participant. The group is gone and no key it held encrypts anything.
    Removed,
    /// A proposal was kept for the next commit.
    Proposed,
}

/// One member as the group's verified state names them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupMember {
    pub leaf_index: u32,
    pub identity: Vec<u8>,
}

/// What is staged for the next commit, in the order the committer added it.
#[derive(Default)]
struct Staged {
    adds: Vec<KeyPackage>,
    removals: Vec<LeafNodeIndex>,
    pause: Option<PauseReasons>,
}

/// One participant's side of a meeting's group. The signing key is made fresh here, held only in this
/// process's memory, and never exported or stored: a credential lasts one stay.
pub struct Session {
    provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
    group: Option<MlsGroup>,
    staged: Staged,
}

fn capabilities() -> Capabilities {
    Capabilities::new(
        None,
        Some(&[CIPHERSUITE]),
        Some(&[ExtensionType::Unknown(PAUSE_EXTENSION_TYPE)]),
        None,
        Some(&[CredentialType::Basic]),
    )
}

/// The group context's extensions for a pause state. A group context extensions proposal REPLACES the
/// whole list, so the required capabilities travel with every pause and resume, or a pause would quietly
/// drop the rule that nobody joins who cannot read one.
fn context_extensions(pause: PauseReasons) -> Result<Extensions<GroupContext>, MlsError> {
    let required = Extension::RequiredCapabilities(RequiredCapabilitiesExtension::new(
        &[ExtensionType::Unknown(PAUSE_EXTENSION_TYPE)],
        &[],
        &[CredentialType::Basic],
    ));
    let mut extensions = vec![required];
    if pause.is_paused() {
        extensions.push(Extension::Unknown(
            PAUSE_EXTENSION_TYPE,
            UnknownExtension(vec![pause.bits()]),
        ));
    }
    Extensions::from_vec(extensions).map_err(engine)
}

fn read_pause(extensions: &Extensions<GroupContext>) -> PauseReasons {
    match extensions.unknown(PAUSE_EXTENSION_TYPE) {
        // A malformed body is read as paused for every reason rather than refused: a group that says it
        // is paused must never be read as encrypted.
        Some(UnknownExtension(body)) => match body.as_slice() {
            [bits] => PauseReasons::from_bits(*bits).unwrap_or(PauseReasons(PauseReasons::ALL)),
            _ => PauseReasons(PauseReasons::ALL),
        },
        None => PauseReasons::default(),
    }
}

fn identity_of(credential: &Credential) -> Result<Vec<u8>, MlsError> {
    BasicCredential::try_from(credential.clone())
        .map(|basic| basic.identity().to_vec())
        .map_err(|_| MlsError::Identity)
}

fn serialize(message: &MlsMessageOut) -> Result<Vec<u8>, MlsError> {
    message.tls_serialize_detached().map_err(engine)
}

fn deserialize(bytes: &[u8]) -> Result<MlsMessageIn, MlsError> {
    MlsMessageIn::tls_deserialize_exact(bytes).map_err(|_| MlsError::Malformed)
}

impl Session {
    /// A participant whose credential names `identity`: the handle of the stay the room seated them on.
    pub fn new(identity: &[u8]) -> Result<Self, MlsError> {
        if identity.is_empty() || identity.len() > IDENTITY_MAXIMUM_LENGTH {
            return Err(MlsError::Identity);
        }
        let provider = OpenMlsRustCrypto::default();
        let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).map_err(engine)?;
        signer.store(provider.storage()).map_err(engine)?;
        let credential = CredentialWithKey {
            credential: BasicCredential::new(identity.to_vec()).into(),
            signature_key: signer.public().into(),
        };
        Ok(Self {
            provider,
            signer,
            credential,
            group: None,
            staged: Staged::default(),
        })
    }

    /// A key package for the committer to admit this participant with, serialized as an MLS message.
    pub fn key_package(&self) -> Result<Vec<u8>, MlsError> {
        let bundle = KeyPackage::builder()
            .leaf_node_capabilities(capabilities())
            .build(
                CIPHERSUITE,
                &self.provider,
                &self.signer,
                self.credential.clone(),
            )
            .map_err(engine)?;
        serialize(&MlsMessageOut::from(bundle.key_package().clone()))
    }

    /// Start the meeting's group with this participant alone in it, encrypted. The first host to arrive
    /// does this; `group_id` is the meeting's handle.
    pub fn create_group(&mut self, group_id: &[u8]) -> Result<(), MlsError> {
        if self.group.is_some() {
            return Err(MlsError::AlreadyInGroup);
        }
        if group_id.is_empty() || group_id.len() > GROUP_ID_MAXIMUM_LENGTH {
            return Err(MlsError::GroupId);
        }
        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .capabilities(capabilities())
            .with_group_context_extensions(context_extensions(PauseReasons::default())?)
            .build();
        let group = MlsGroup::new_with_group_id(
            &self.provider,
            &self.signer,
            &config,
            GroupId::from_slice(group_id),
            self.credential.clone(),
        )
        .map_err(engine)?;
        self.group = Some(group);
        Ok(())
    }

    /// Join from a welcome the room delivered, refusing one for any group but `group_id`.
    pub fn join(&mut self, welcome: &[u8], group_id: &[u8]) -> Result<(), MlsError> {
        if self.group.is_some() {
            return Err(MlsError::AlreadyInGroup);
        }
        let welcome = match deserialize(welcome)?.extract() {
            MlsMessageBodyIn::Welcome(welcome) => welcome,
            _ => return Err(MlsError::Malformed),
        };
        let config = MlsGroupJoinConfig::builder()
            .use_ratchet_tree_extension(true)
            .build();
        let staged = StagedWelcome::new_from_welcome(&self.provider, &config, welcome, None)
            .map_err(|_| MlsError::Refused)?;
        if staged.group_context().group_id().as_slice() != group_id {
            return Err(MlsError::WrongGroup);
        }
        let group = staged.into_group(&self.provider).map_err(engine)?;
        self.group = Some(group);
        Ok(())
    }

    fn group(&self) -> Result<&MlsGroup, MlsError> {
        self.group.as_ref().ok_or(MlsError::NotInGroup)
    }

    /// Stage an admission. `expected_identity` is the stay the room says sent the key package; a package
    /// whose credential names anybody else is refused, so the room cannot seat one stay under another's
    /// name without the security code showing it.
    pub fn stage_add(
        &mut self,
        expected_identity: &[u8],
        key_package: &[u8],
    ) -> Result<(), MlsError> {
        let group = self.group()?;
        let package_in = match deserialize(key_package)?.extract() {
            MlsMessageBodyIn::KeyPackage(package) => package,
            _ => return Err(MlsError::Malformed),
        };
        let package = package_in
            .validate(self.provider.crypto(), ProtocolVersion::Mls10)
            .map_err(|_| MlsError::KeyPackage)?;
        if package.ciphersuite() != CIPHERSUITE {
            return Err(MlsError::KeyPackage);
        }
        let identity = identity_of(package.leaf_node().credential())?;
        if identity != expected_identity {
            return Err(MlsError::IdentityMismatch);
        }
        let already = group
            .members()
            .any(|member| identity_of(&member.credential).ok().as_deref() == Some(&identity))
            || self.staged.adds.iter().any(|staged| {
                identity_of(staged.leaf_node().credential()).ok().as_deref() == Some(&identity)
            });
        if already {
            return Err(MlsError::AlreadyInGroup);
        }
        self.staged.adds.push(package);
        Ok(())
    }

    /// Stage a departure, by the identity the departed member's credential carries.
    pub fn stage_remove(&mut self, identity: &[u8]) -> Result<(), MlsError> {
        let own = self.own_leaf_index()?;
        let leaf = self
            .leaf_index_of(identity)?
            .ok_or(MlsError::UnknownMember)?;
        if leaf == own {
            // A member does not commit its own removal; the next committer removes it.
            return Err(MlsError::Refused);
        }
        let leaf = LeafNodeIndex::new(leaf);
        if !self.staged.removals.contains(&leaf) {
            self.staged.removals.push(leaf);
        }
        Ok(())
    }

    /// Stage the pause state the next commit writes into the group context.
    pub fn stage_pause(&mut self, bits: u8) -> Result<(), MlsError> {
        self.group()?;
        self.staged.pause = Some(PauseReasons::from_bits(bits)?);
        Ok(())
    }

    /// Commit everything staged, and every proposal the room has delivered, as one commit. The group does
    /// not move until [`Session::confirm_commit`]: the room may have sequenced another commit first.
    pub fn commit(&mut self) -> Result<CommitOutput, MlsError> {
        let staged = std::mem::take(&mut self.staged);
        let pause_extensions = match staged.pause {
            Some(pause) => Some(context_extensions(pause)?),
            None => None,
        };
        let group = self.group.as_mut().ok_or(MlsError::NotInGroup)?;
        if group.pending_commit().is_some() {
            return Err(MlsError::PendingCommit);
        }
        let nothing_staged =
            staged.adds.is_empty() && staged.removals.is_empty() && pause_extensions.is_none();
        if nothing_staged && group.pending_proposals().next().is_none() {
            return Err(MlsError::NothingToCommit);
        }
        // A pause staged here and a pause proposal from somebody else would be two context changes in
        // one commit, which MLS refuses; the committer's own is the later word, so it wins.
        let consume_proposals = pause_extensions.is_none();
        let mut builder = group
            .commit_builder()
            .consume_proposal_store(consume_proposals)
            .propose_removals(staged.removals)
            .propose_adds(staged.adds);
        if let Some(extensions) = pause_extensions {
            builder = builder
                .propose_group_context_extensions(extensions)
                .map_err(engine)?;
        }
        let bundle = builder
            .load_psks(self.provider.storage())
            .map_err(engine)?
            .build(
                self.provider.rand(),
                self.provider.crypto(),
                &self.signer,
                |_| true,
            )
            .map_err(|_| MlsError::Refused)?
            .stage_commit(&self.provider)
            .map_err(|_| MlsError::Refused)?;
        let welcome = match bundle.to_welcome_msg() {
            Some(welcome) => Some(serialize(&welcome)?),
            None => None,
        };
        let commit = serialize(bundle.commit())?;
        Ok(CommitOutput { commit, welcome })
    }

    /// The room sequenced this participant's commit: apply it.
    pub fn confirm_commit(&mut self) -> Result<(), MlsError> {
        let provider = &self.provider;
        let group = self.group.as_mut().ok_or(MlsError::NotInGroup)?;
        if group.pending_commit().is_none() {
            return Err(MlsError::NoPendingCommit);
        }
        group.merge_pending_commit(provider).map_err(engine)
    }

    /// The room sequenced somebody else's commit first: forget this one. What it staged is not restaged;
    /// the caller restages what is still true after the other commit is processed.
    pub fn discard_commit(&mut self) -> Result<(), MlsError> {
        let provider = &self.provider;
        let group = self.group.as_mut().ok_or(MlsError::NotInGroup)?;
        group
            .clear_pending_commit(provider.storage())
            .map_err(engine)
    }

    /// A proposal to change the pause state, for a participant who is not the committer: the room
    /// delivers it to everybody, and the committer's next commit carries it.
    pub fn propose_pause(&mut self, bits: u8) -> Result<Vec<u8>, MlsError> {
        let extensions = context_extensions(PauseReasons::from_bits(bits)?)?;
        let provider = &self.provider;
        let signer = &self.signer;
        let group = self.group.as_mut().ok_or(MlsError::NotInGroup)?;
        let (message, _) = group
            .propose_group_context_extensions(provider, extensions, signer)
            .map_err(|_| MlsError::Refused)?;
        serialize(&message)
    }

    /// Apply a handshake message somebody else sent, in the order the room delivered it.
    pub fn process(&mut self, message: &[u8]) -> Result<Processed, MlsError> {
        let provider = &self.provider;
        let group = self.group.as_mut().ok_or(MlsError::NotInGroup)?;
        let protocol = deserialize(message)?
            .try_into_protocol_message()
            .map_err(|_| MlsError::Malformed)?;
        if protocol.group_id() != group.group_id() {
            return Err(MlsError::WrongGroup);
        }
        let processed = group
            .process_message(provider, protocol)
            .map_err(|error| match error {
                ProcessMessageError::ValidationError(ValidationError::WrongEpoch) => {
                    MlsError::WrongEpoch
                }
                ProcessMessageError::ValidationError(ValidationError::WrongGroupId) => {
                    MlsError::WrongGroup
                }
                _ => MlsError::Refused,
            })?;
        match processed.into_content() {
            ProcessedMessageContent::StagedCommitMessage(staged) => {
                let removed = staged.self_removed();
                group
                    .merge_staged_commit(provider, *staged)
                    .map_err(engine)?;
                if removed {
                    self.group = None;
                    self.staged = Staged::default();
                    return Ok(Processed::Removed);
                }
                Ok(Processed::Committed)
            }
            ProcessedMessageContent::ProposalMessage(proposal) => {
                // Only a pause change travels as a proposal. Admissions and departures are the
                // committer's, from what the room says, so a member who proposes one is refused.
                match proposal.proposal() {
                    Proposal::GroupContextExtensions(_) => {}
                    _ => return Err(MlsError::Refused),
                }
                group
                    .store_pending_proposal(provider.storage(), *proposal)
                    .map_err(engine)?;
                Ok(Processed::Proposed)
            }
            // Media keys come from the exporter; the group carries no application messages, and a
            // participant who sends one is refused rather than read.
            _ => Err(MlsError::Refused),
        }
    }

    /// The group's epoch. It advances with every commit, and the keys with it.
    pub fn epoch(&self) -> Result<u64, MlsError> {
        Ok(self.group()?.epoch().as_u64())
    }

    /// This participant's leaf index: the sender index its SFrame key identifiers carry.
    pub fn own_leaf_index(&self) -> Result<u32, MlsError> {
        Ok(self.group()?.own_leaf_index().u32())
    }

    /// Every member, by leaf index, as the verified group state names them.
    pub fn members(&self) -> Result<Vec<GroupMember>, MlsError> {
        let group = self.group()?;
        let mut members = Vec::new();
        for member in group.members() {
            members.push(GroupMember {
                leaf_index: member.index.u32(),
                identity: identity_of(&member.credential)?,
            });
        }
        members.sort_by_key(|member| member.leaf_index);
        Ok(members)
    }

    /// The leaf index of the member whose credential names `identity`, if one does.
    pub fn leaf_index_of(&self, identity: &[u8]) -> Result<Option<u32>, MlsError> {
        Ok(self
            .members()?
            .into_iter()
            .find(|member| member.identity == identity)
            .map(|member| member.leaf_index))
    }

    /// Whether this participant commits: the member with the smallest leaf index, among the ones the room
    /// says are still connected (`live_identities`). A departed committer cannot commit its own removal,
    /// so the next one down takes over without anybody having to agree on it.
    pub fn is_committer(&self, live_identities: &[Vec<u8>]) -> Result<bool, MlsError> {
        let own = self.own_leaf_index()?;
        let smallest_live = self
            .members()?
            .into_iter()
            .filter(|member| member.leaf_index == own || live_identities.contains(&member.identity))
            .map(|member| member.leaf_index)
            .min();
        Ok(smallest_live == Some(own))
    }

    /// Why the group says encryption is paused; no bits set means it is encrypted.
    pub fn pause(&self) -> Result<PauseReasons, MlsError> {
        Ok(read_pause(self.group()?.extensions()))
    }

    /// The epoch's SFrame base key (RFC 9605, section 5.2). The frame transform derives each sender's key
    /// and salt from it and from the key identifier.
    pub fn sframe_base_key(&self) -> Result<Vec<u8>, MlsError> {
        self.group()?
            .export_secret(
                self.provider.crypto(),
                SFRAME_EXPORTER_LABEL,
                &[],
                SFRAME_BASE_KEY_LENGTH,
            )
            .map_err(engine)
    }

    /// The security code: digit groups every member computes from the group's member list, credentials and
    /// signature keys. Two browsers showing the same code are in the same group with the same people. It
    /// changes when anybody joins or leaves, and not when only the epoch moves.
    pub fn security_code(&self) -> Result<String, MlsError> {
        let group = self.group()?;
        let mut members: Vec<Member> = group.members().collect();
        members.sort_by_key(|member| member.index.u32());
        let mut transcript = Vec::new();
        append_field(&mut transcript, b"Magna Carta meeting security code 1");
        append_field(&mut transcript, group.group_id().as_slice());
        for member in &members {
            transcript.extend_from_slice(&member.index.u32().to_be_bytes());
            append_field(&mut transcript, &identity_of(&member.credential)?);
            append_field(&mut transcript, &member.signature_key);
        }
        let digest = self
            .provider
            .crypto()
            .hash(HashType::Sha2_256, &transcript)
            .map_err(engine)?;
        Ok(render_security_code(&digest))
    }
}

/// A field with its length in front, so no two different member lists hash the same bytes.
fn append_field(transcript: &mut Vec<u8>, field: &[u8]) {
    transcript.extend_from_slice(&(field.len() as u64).to_be_bytes());
    transcript.extend_from_slice(field);
}

/// Groups of five decimal digits, each from five bytes of the digest taken modulo 100,000: the safety
/// number's construction, so every group is near-uniform.
fn render_security_code(digest: &[u8]) -> String {
    digest
        .chunks_exact(5)
        .take(SECURITY_CODE_GROUPS)
        .map(|chunk| {
            let value = chunk
                .iter()
                .fold(0_u64, |value, byte| (value << 8) | u64::from(*byte));
            format!(
                "{:0width$}",
                value % 100_000,
                width = SECURITY_CODE_GROUP_DIGITS
            )
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests;
