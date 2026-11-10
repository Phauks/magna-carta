use super::*;

const GROUP: &[u8] = b"meeting_01";

fn session(name: &str) -> Session {
    Session::new(name.as_bytes()).unwrap()
}

/// A host alone in a new group, then `others` admitted in one commit and joined from its welcome.
fn group_of(others: &[&str]) -> (Session, Vec<Session>) {
    let mut host = session("host");
    host.create_group(GROUP).unwrap();
    let mut joiners: Vec<Session> = others.iter().map(|name| session(name)).collect();
    for joiner in &joiners {
        host.stage_add(
            joiner_identity(joiner).as_slice(),
            &joiner.key_package().unwrap(),
        )
        .unwrap();
    }
    let output = host.commit().unwrap();
    host.confirm_commit().unwrap();
    let welcome = output.welcome.unwrap();
    for joiner in &mut joiners {
        joiner.join(&welcome, GROUP).unwrap();
    }
    (host, joiners)
}

fn joiner_identity(session: &Session) -> Vec<u8> {
    identity_of(&session.credential.credential).unwrap()
}

#[test]
fn everybody_admitted_derives_the_same_base_key_and_code() {
    let (host, joiners) = group_of(&["alice", "bob"]);
    let key = host.sframe_base_key().unwrap();
    assert_eq!(key.len(), SFRAME_BASE_KEY_LENGTH);
    for joiner in &joiners {
        assert_eq!(joiner.sframe_base_key().unwrap(), key);
        assert_eq!(joiner.epoch().unwrap(), host.epoch().unwrap());
        assert_eq!(
            joiner.security_code().unwrap(),
            host.security_code().unwrap()
        );
    }
    let names: Vec<Vec<u8>> = host
        .members()
        .unwrap()
        .into_iter()
        .map(|member| member.identity)
        .collect();
    assert_eq!(
        names,
        vec![b"host".to_vec(), b"alice".to_vec(), b"bob".to_vec()]
    );
    assert_eq!(host.own_leaf_index().unwrap(), 0);
    assert!(!host.pause().unwrap().is_paused());
}

#[test]
fn a_key_package_under_another_stays_name_is_refused() {
    let mut host = session("host");
    host.create_group(GROUP).unwrap();
    let mallory = session("mallory");
    assert_eq!(
        host.stage_add(b"alice", &mallory.key_package().unwrap()),
        Err(MlsError::IdentityMismatch)
    );
    assert_eq!(
        host.stage_add(b"alice", b"not a message"),
        Err(MlsError::Malformed)
    );
    assert_eq!(host.commit(), Err(MlsError::NothingToCommit));
}

#[test]
fn the_same_stay_cannot_be_admitted_twice() {
    let (mut host, _) = group_of(&["alice"]);
    let again = session("alice");
    assert_eq!(
        host.stage_add(b"alice", &again.key_package().unwrap()),
        Err(MlsError::AlreadyInGroup)
    );
}

#[test]
fn a_removed_member_is_told_and_holds_nothing_that_still_encrypts() {
    let (mut host, mut joiners) = group_of(&["alice", "bob"]);
    let before = host.sframe_base_key().unwrap();
    host.stage_remove(b"bob").unwrap();
    let output = host.commit().unwrap();
    assert!(output.welcome.is_none());
    host.confirm_commit().unwrap();

    let (alice, rest) = joiners.split_at_mut(1);
    assert_eq!(alice[0].process(&output.commit), Ok(Processed::Committed));
    assert_eq!(rest[0].process(&output.commit), Ok(Processed::Removed));
    assert_eq!(rest[0].sframe_base_key(), Err(MlsError::NotInGroup));

    let after = host.sframe_base_key().unwrap();
    assert_ne!(after, before);
    assert_eq!(alice[0].sframe_base_key().unwrap(), after);
    assert_eq!(host.members().unwrap().len(), 2);
}

#[test]
fn a_member_never_commits_its_own_removal_and_an_unknown_one_is_refused() {
    let (mut host, _) = group_of(&["alice"]);
    assert_eq!(host.stage_remove(b"host"), Err(MlsError::Refused));
    assert_eq!(host.stage_remove(b"carol"), Err(MlsError::UnknownMember));
}

#[test]
fn a_pause_is_read_from_the_group_and_a_resume_brings_new_keys() {
    let (mut host, mut joiners) = group_of(&["alice"]);
    host.stage_pause(PauseReasons::RECORDING | PauseReasons::PHONE)
        .unwrap();
    let paused = host.commit().unwrap();
    host.confirm_commit().unwrap();
    joiners[0].process(&paused.commit).unwrap();
    for member in [&host, &joiners[0]] {
        let pause = member.pause().unwrap();
        assert!(pause.is_paused());
        assert_eq!(pause.bits(), PauseReasons::RECORDING | PauseReasons::PHONE);
    }
    let paused_key = host.sframe_base_key().unwrap();

    host.stage_pause(0).unwrap();
    let resumed = host.commit().unwrap();
    host.confirm_commit().unwrap();
    joiners[0].process(&resumed.commit).unwrap();
    assert!(!joiners[0].pause().unwrap().is_paused());
    assert_ne!(host.sframe_base_key().unwrap(), paused_key);

    // The required capabilities travelled with both changes: a later admission still works.
    let mut carol = session("carol");
    host.stage_add(b"carol", &carol.key_package().unwrap())
        .unwrap();
    let output = host.commit().unwrap();
    host.confirm_commit().unwrap();
    carol.join(&output.welcome.unwrap(), GROUP).unwrap();
    assert_eq!(
        carol.sframe_base_key().unwrap(),
        host.sframe_base_key().unwrap()
    );
}

#[test]
fn a_pause_proposed_by_somebody_else_is_carried_by_the_committers_next_commit() {
    let (mut host, mut joiners) = group_of(&["alice", "bob"]);
    let proposal = joiners[0].propose_pause(PauseReasons::CAPTIONS).unwrap();
    assert_eq!(host.process(&proposal), Ok(Processed::Proposed));
    assert_eq!(joiners[1].process(&proposal), Ok(Processed::Proposed));

    let output = host.commit().unwrap();
    host.confirm_commit().unwrap();
    for joiner in &mut joiners {
        joiner.process(&output.commit).unwrap();
        assert_eq!(joiner.pause().unwrap().bits(), PauseReasons::CAPTIONS);
    }
    assert_eq!(host.pause().unwrap().bits(), PauseReasons::CAPTIONS);
}

#[test]
fn a_reason_nobody_owns_is_refused() {
    assert_eq!(PauseReasons::from_bits(0b1000), Err(MlsError::PauseReason));
    let (mut host, _) = group_of(&["alice"]);
    assert_eq!(host.stage_pause(0b1000), Err(MlsError::PauseReason));
}

#[test]
fn a_commit_the_room_sequenced_second_is_discarded_and_the_first_applied() {
    let (mut host, mut joiners) = group_of(&["alice", "bob"]);
    // Both believe they commit; the room delivers alice's first.
    host.stage_pause(PauseReasons::RECORDING).unwrap();
    let _losing = host.commit().unwrap();
    joiners[0].stage_remove(b"bob").unwrap();
    let winning = joiners[0].commit().unwrap();
    joiners[0].confirm_commit().unwrap();

    host.discard_commit().unwrap();
    assert_eq!(host.process(&winning.commit), Ok(Processed::Committed));
    assert_eq!(
        host.sframe_base_key().unwrap(),
        joiners[0].sframe_base_key().unwrap()
    );
    assert_eq!(host.confirm_commit(), Err(MlsError::NoPendingCommit));
}

#[test]
fn a_commit_from_an_old_epoch_is_named_as_such() {
    let (mut host, mut joiners) = group_of(&["alice"]);
    host.stage_pause(PauseReasons::RECORDING).unwrap();
    let first = host.commit().unwrap();
    host.confirm_commit().unwrap();
    joiners[0].process(&first.commit).unwrap();
    assert_eq!(joiners[0].process(&first.commit), Err(MlsError::WrongEpoch));
}

#[test]
fn a_welcome_for_another_meeting_is_refused() {
    let mut host = session("host");
    host.create_group(b"meeting_02").unwrap();
    let mut alice = session("alice");
    host.stage_add(b"alice", &alice.key_package().unwrap())
        .unwrap();
    let output = host.commit().unwrap();
    assert_eq!(
        alice.join(&output.welcome.unwrap(), GROUP),
        Err(MlsError::WrongGroup)
    );
}

#[test]
fn the_committer_is_the_smallest_live_leaf() {
    let (host, joiners) = group_of(&["alice", "bob"]);
    let everybody = vec![b"host".to_vec(), b"alice".to_vec(), b"bob".to_vec()];
    assert!(host.is_committer(&everybody).unwrap());
    assert!(!joiners[0].is_committer(&everybody).unwrap());
    // The host's socket is gone: alice takes over, and bob still does not.
    let without_host = vec![b"alice".to_vec(), b"bob".to_vec()];
    assert!(joiners[0].is_committer(&without_host).unwrap());
    assert!(!joiners[1].is_committer(&without_host).unwrap());
}

#[test]
fn the_security_code_follows_the_people_not_the_epoch() {
    let (mut host, mut joiners) = group_of(&["alice"]);
    let code = host.security_code().unwrap();
    let groups: Vec<&str> = code.split(' ').collect();
    assert_eq!(groups.len(), SECURITY_CODE_GROUPS);
    assert!(groups
        .iter()
        .all(|group| group.len() == SECURITY_CODE_GROUP_DIGITS
            && group.bytes().all(|byte| byte.is_ascii_digit())));

    host.stage_pause(PauseReasons::RECORDING).unwrap();
    let paused = host.commit().unwrap();
    host.confirm_commit().unwrap();
    joiners[0].process(&paused.commit).unwrap();
    assert_eq!(host.security_code().unwrap(), code);

    let bob = session("bob");
    host.stage_add(b"bob", &bob.key_package().unwrap()).unwrap();
    host.commit().unwrap();
    host.confirm_commit().unwrap();
    assert_ne!(host.security_code().unwrap(), code);
}

#[test]
fn nothing_is_read_before_a_group_exists_and_identities_are_bounded() {
    let alice = session("alice");
    assert_eq!(alice.epoch(), Err(MlsError::NotInGroup));
    assert_eq!(alice.sframe_base_key(), Err(MlsError::NotInGroup));
    assert!(matches!(Session::new(b""), Err(MlsError::Identity)));
    assert!(matches!(
        Session::new(&[b'a'; IDENTITY_MAXIMUM_LENGTH + 1]),
        Err(MlsError::Identity)
    ));
    let mut host = session("host");
    assert_eq!(host.create_group(b""), Err(MlsError::GroupId));
    host.create_group(GROUP).unwrap();
    assert_eq!(host.create_group(GROUP), Err(MlsError::AlreadyInGroup));
}

#[test]
fn a_member_who_proposes_an_admission_is_refused() {
    let (mut host, mut joiners) = group_of(&["alice"]);
    let carol = session("carol");
    let package = match deserialize(&carol.key_package().unwrap())
        .unwrap()
        .extract()
    {
        MlsMessageBodyIn::KeyPackage(package) => package
            .validate(joiners[0].provider.crypto(), ProtocolVersion::Mls10)
            .unwrap(),
        _ => unreachable!(),
    };
    let alice = &mut joiners[0];
    let (proposal, _) = alice
        .group
        .as_mut()
        .unwrap()
        .propose_add_member(&alice.provider, &alice.signer, &package)
        .unwrap();
    assert_eq!(
        host.process(&serialize(&proposal).unwrap()),
        Err(MlsError::Refused)
    );
}

/// What the wire has to carry at the room's ceiling, which sets the meeting protocol's frame ceiling
/// (`MAX_MLS_MESSAGE_BASE64_LENGTH` in packages/meeting-protocol/src/frames.ts, 240 KiB of base64,
/// so 184,320 bytes before encoding). Slow unoptimized, so run by hand:
/// `cargo test --release -p mls-core sizes -- --ignored`. On 2026-11-10 the three hundredth
/// admission's welcome was 59,737 bytes, its commit 476, a key package 303, and a removal's commit at
/// three hundred 25,124.
#[test]
#[ignore = "a measurement at three hundred, run by hand in release"]
fn the_sizes_at_three_hundred_fit_one_frame() {
    const MESSAGE_CEILING: usize = 184_320;
    let mut host = session("host");
    host.create_group(GROUP).unwrap();
    for index in 1..300 {
        let joiner = session(&format!("stay_{index:024}"));
        let key_package = joiner.key_package().unwrap();
        host.stage_add(joiner_identity(&joiner).as_slice(), &key_package)
            .unwrap();
        let output = host.commit().unwrap();
        host.confirm_commit().unwrap();
        let welcome = output.welcome.unwrap();
        assert!(
            key_package.len() < 1_024,
            "key package {}",
            key_package.len()
        );
        assert!(
            output.commit.len() < MESSAGE_CEILING,
            "commit {}",
            output.commit.len()
        );
        assert!(welcome.len() < MESSAGE_CEILING, "welcome {}", welcome.len());
    }
    let leaver = host.members().unwrap()[150].identity.clone();
    host.stage_remove(&leaver).unwrap();
    let removal = host.commit().unwrap().commit;
    assert!(removal.len() < MESSAGE_CEILING, "removal {}", removal.len());
}
