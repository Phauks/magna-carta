//! The monthly build: OpenAddresses in, four partition splits, an attribution manifest and a pointer out.
//!
//! 1. Fetch the source list; keep United States address layers that pass the licence policy; group them
//!    by partition.
//! 2. For each partition: stream each source's lines, clean them, drop duplicates within the state,
//!    index into scratch, merge to one segment, stream the split up in parts, delete the scratch.
//! 3. Write the manifest, then the pointer. Delete the build before the previous one: two are kept, so a
//!    query container that has not yet re-read the pointer is never cut off mid-query.
//!
//! A failure anywhere leaves the pointer where it was, so the old index keeps answering; whatever this
//! build had already uploaded is deleted, best effort.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};

use address_core::{
    parse_feature_line, state_of_source, BuildOptions, Deduplicator, Partition, PartitionBuilder,
};
use serde::Serialize;

use crate::clock::{build_identifier, now_seconds, timestamp};
use crate::object_client::{ObjectStore, ObjectWriter};
use crate::pointer::{
    attribution_key, pointer_key, split_key, AttributionManifest, ExcludedSource, IncludedSource,
    Pointer,
};
use crate::source_client::{next_line, SourceClient, SourceListing};

/// The object store's multipart part size: every part but the last is exactly this.
pub const PART_SIZE: usize = 64 * 1024 * 1024;

/// One source the licence policy keeps out of the index.
#[derive(Clone, Copy, Debug)]
pub struct LicenceExclusion {
    /// The source list's `source`.
    pub source: &'static str,
    /// The source list's `name` (the layer's name within the source).
    pub name: &'static str,
    /// The recorded licence, and so why it is excluded.
    pub reason: &'static str,
}

/// The owner-confirmed exclusion register for the licence policy. A source is included when its
/// recorded licence is permissive or absent (most United States sources record none, and excluding
/// those would empty the index); it is excluded when the recorded licence is share-alike,
/// non-commercial, or a bespoke agreement. The source list carries no licence text, so the policy is
/// this register of the sources whose recorded licence was read and found to be one of those, matched
/// on the address layer's `(source, name)`. A recorded licence that is only an indemnification clause
/// is a disclaimer accepted by using the data, and is included. Adding a source here removes it from the
/// next build; every build's attribution manifest lists what was excluded and why.
pub const LICENCE_EXCLUSIONS: &[LicenceExclusion] = &[
    LicenceExclusion {
        source: "us/ca/mono",
        name: "county",
        reason: "CC BY-SA 4.0 (share-alike)",
    },
    LicenceExclusion {
        source: "us/or/city_of_tigard",
        name: "city",
        reason: "CC BY-SA 4.0 (share-alike)",
    },
    LicenceExclusion {
        source: "us/wa/jefferson",
        name: "county",
        reason: "ODbL 1.0 (share-alike)",
    },
    LicenceExclusion {
        source: "us/wa/spokane",
        name: "county",
        reason: "CC BY-NC-SA 4.0 (non-commercial, share-alike)",
    },
    LicenceExclusion {
        source: "us/mi/semcog",
        name: "county",
        reason: "SEMCOG Copyright License Agreement (bespoke agreement)",
    },
    LicenceExclusion {
        source: "us/mi/semcog",
        name: "condos",
        reason: "SEMCOG Copyright License Agreement (bespoke agreement)",
    },
    LicenceExclusion {
        source: "us/tx/capcog",
        name: "state",
        reason: "CC BY-SA (share-alike)",
    },
    LicenceExclusion {
        source: "us/or/portland_metro",
        name: "city",
        reason: "RLIS Open Database End User License (share-alike)",
    },
];

/// Where and how a build runs.
#[derive(Clone, Debug)]
pub struct BuildSettings {
    pub object_base_url: String,
    pub source_base_url: String,
    pub part_size: usize,
    pub options: BuildOptions,
    /// Parent of each partition's scratch directory (`/scratch` in the image, via TMPDIR).
    pub scratch_root: PathBuf,
}

/// A source chosen for the build.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SelectedSource {
    pub source: String,
    pub name: String,
    pub job: u64,
    pub state: String,
}

/// The sources a build will read, by partition, and the ones the policy kept out.
#[derive(Debug, Default)]
pub struct Selection {
    pub by_partition: BTreeMap<Partition, Vec<SelectedSource>>,
    pub excluded: Vec<ExcludedSource>,
}

impl Selection {
    pub fn source_count(&self) -> usize {
        self.by_partition.values().map(Vec::len).sum()
    }
}

/// Apply the layer, country and licence policy to the source list.
pub fn select_sources(listing: Vec<SourceListing>) -> Selection {
    let mut selection = Selection::default();
    for entry in listing {
        if entry.layer != "addresses" || !entry.source.starts_with("us/") {
            continue;
        }
        if let Some(exclusion) = LICENCE_EXCLUSIONS
            .iter()
            .find(|exclusion| exclusion.source == entry.source && exclusion.name == entry.name)
        {
            selection.excluded.push(ExcludedSource {
                source: entry.source,
                name: entry.name,
                reason: exclusion.reason.to_owned(),
            });
            continue;
        }
        let (Some(state), Some(job)) = (state_of_source(&entry.source), entry.job) else {
            continue;
        };
        selection
            .by_partition
            .entry(Partition::for_state(&state))
            .or_default()
            .push(SelectedSource {
                source: entry.source,
                name: entry.name,
                job,
                state,
            });
    }
    for sources in selection.by_partition.values_mut() {
        sources
            .sort_by(|left, right| (&left.source, &left.name).cmp(&(&right.source, &right.name)));
    }
    selection
}

/// Why a build failed, in engine vocabulary: never an object key, never an address.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BuildFailure(pub String);

impl BuildFailure {
    fn because(what: &str, error: impl std::fmt::Display) -> Self {
        Self(format!("{what}: {error}"))
    }
}

/// What a finished build published.
#[derive(Clone, Debug)]
pub struct BuildOutcome {
    pub pointer: Pointer,
    pub manifest: AttributionManifest,
}

struct BuildContext<'a> {
    writer: &'a ObjectWriter,
    sources: &'a SourceClient,
    settings: &'a BuildSettings,
}

/// Build one partition and stream its split up. Returns the documents indexed.
fn build_partition(
    context: &BuildContext<'_>,
    partition: Partition,
    sources: &[SelectedSource],
    key: &str,
) -> Result<u64, BuildFailure> {
    let scratch = tempfile::Builder::new()
        .prefix("address-partition-")
        .tempdir_in(&context.settings.scratch_root)
        .map_err(|error| BuildFailure::because("scratch directory unavailable", error))?;
    let mut builder = PartitionBuilder::create(scratch.path(), &context.settings.options)
        .map_err(|error| BuildFailure::because("index could not be started", error))?;
    // Keys are per state and no state spans two partitions, so one de-duplicator per partition holds
    // every key that can still match.
    let mut deduplicator = Deduplicator::new();
    let mut line = Vec::new();
    for source in sources {
        let mut reader = context
            .sources
            .open(source.job)
            .map_err(|error| BuildFailure::because("source download failed", error))?;
        while next_line(&mut reader, &mut line)
            .map_err(|error| BuildFailure::because("source download failed", error))?
        {
            let text = String::from_utf8_lossy(&line);
            let Some(address) = parse_feature_line(&text, &source.state) else {
                continue;
            };
            if deduplicator.admit(&address) {
                builder
                    .add(&address)
                    .map_err(|error| BuildFailure::because("indexing failed", error))?;
            }
        }
    }
    drop(deduplicator);
    let built = builder
        .finish()
        .map_err(|error| BuildFailure::because("index merge failed", error))?;
    let mut upload = context
        .writer
        .multipart(key, context.settings.part_size)
        .map_err(|error| BuildFailure::because("split upload failed", error))?;
    built
        .write_split(&mut upload)
        .map_err(|error| BuildFailure::because("split upload failed", error))?;
    let bytes = upload
        .finish()
        .map_err(|error| BuildFailure::because("split upload failed", error))?;
    eprintln!(
        "address: built the {} partition: {} addresses, {bytes} bytes",
        partition.name(),
        built.document_count()
    );
    Ok(built.document_count())
}

fn read_pointer(store: &ObjectStore) -> Result<Option<Pointer>, BuildFailure> {
    match store.get_small(&pointer_key()) {
        Ok(Some(bytes)) => Ok(serde_json::from_slice(&bytes).ok()),
        Ok(None) => Ok(None),
        Err(error) => Err(BuildFailure::because("index pointer unreadable", error)),
    }
}

/// A build id not already in use by the published build or the one before it. Builds are days apart,
/// so a clash only happens when two run within one second; a suffix keeps them apart.
fn fresh_build_identifier(seconds: u64, taken: &[&str]) -> String {
    let base = build_identifier(seconds);
    let mut candidate = base.clone();
    let mut suffix = 1;
    while taken.contains(&candidate.as_str()) {
        candidate = format!("{base}-{suffix}");
        suffix += 1;
    }
    candidate
}

fn delete_build(writer: &ObjectWriter, build: &str) {
    for partition in Partition::ALL {
        if let Err(error) = writer.delete(&split_key(build, partition)) {
            eprintln!("address: an old split could not be deleted: {error}");
        }
    }
    if let Err(error) = writer.delete(&attribution_key(build)) {
        eprintln!("address: an old manifest could not be deleted: {error}");
    }
}

/// Run a whole build. Blocking, and long: call from a dedicated thread.
pub fn run_build(settings: &BuildSettings) -> Result<BuildOutcome, BuildFailure> {
    let store = ObjectStore::new(&settings.object_base_url);
    let writer = ObjectWriter::new(&settings.object_base_url);
    let sources = SourceClient::new(&settings.source_base_url);
    let context = BuildContext {
        writer: &writer,
        sources: &sources,
        settings,
    };

    let listing = sources
        .list()
        .map_err(|error| BuildFailure::because("source list unavailable", error))?;
    let selection = select_sources(listing);
    if selection.source_count() == 0 {
        return Err(BuildFailure(
            "no source passed the layer and licence policy".to_owned(),
        ));
    }

    let previous = read_pointer(&store)?;
    let previous_manifest = previous.as_ref().and_then(|pointer| {
        store
            .get_small(&pointer.attribution)
            .ok()
            .flatten()
            .and_then(|bytes| serde_json::from_slice::<AttributionManifest>(&bytes).ok())
    });
    let previous_build = previous.as_ref().map(|pointer| pointer.build.clone());
    let before_previous = previous_manifest.and_then(|manifest| manifest.previous_build);
    let started = now_seconds();
    let taken: Vec<&str> = [previous_build.as_deref(), before_previous.as_deref()]
        .into_iter()
        .flatten()
        .collect();
    let build = fresh_build_identifier(started, &taken);

    let mut partitions = BTreeMap::new();
    let mut document_count = 0_u64;
    for partition in Partition::ALL {
        let key = split_key(&build, partition);
        let chosen = selection
            .by_partition
            .get(&partition)
            .map(Vec::as_slice)
            .unwrap_or_default();
        match build_partition(&context, partition, chosen, &key) {
            Ok(count) => {
                document_count += count;
                partitions.insert(partition.name().to_owned(), key);
            }
            Err(failure) => {
                // Nothing points at these yet; remove what this build put up, best effort.
                delete_build(&writer, &build);
                return Err(failure);
            }
        }
    }

    let built_at = timestamp(now_seconds());
    let manifest = AttributionManifest {
        build: build.clone(),
        built_at: built_at.clone(),
        previous_build: previous_build.clone(),
        sources: selection
            .by_partition
            .values()
            .flatten()
            .map(|source| IncludedSource {
                source: source.source.clone(),
                layer: "addresses".to_owned(),
                name: source.name.clone(),
                job: source.job,
            })
            .collect(),
        excluded: selection.excluded,
    };
    let pointer = Pointer {
        build: build.clone(),
        built_at,
        document_count,
        partitions,
        attribution: attribution_key(&build),
    };
    let publish = || -> Result<(), BuildFailure> {
        let manifest_bytes = serde_json::to_vec_pretty(&manifest)
            .map_err(|error| BuildFailure::because("manifest could not be encoded", error))?;
        writer
            .put_small(&pointer.attribution, &manifest_bytes)
            .map_err(|error| BuildFailure::because("manifest write failed", error))?;
        let pointer_bytes = serde_json::to_vec(&pointer)
            .map_err(|error| BuildFailure::because("pointer could not be encoded", error))?;
        writer
            .put_small(&pointer_key(), &pointer_bytes)
            .map_err(|error| BuildFailure::because("pointer write failed", error))
    };
    if let Err(failure) = publish() {
        delete_build(&writer, &build);
        return Err(failure);
    }

    // Published. The build before the previous one is now two behind and nothing can be reading it.
    if let Some(old) = before_previous {
        if Some(&old) != previous_build.as_ref() && old != build {
            delete_build(&writer, &old);
        }
    }
    Ok(BuildOutcome { pointer, manifest })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BuildState {
    Idle,
    Running,
    Failed,
}

/// `GET /builds`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildStatus {
    pub state: BuildState,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub detail: Option<String>,
}

/// Runs at most one build at a time, on its own thread, and remembers how the last one ended.
#[derive(Debug)]
pub struct BuildRunner {
    settings: BuildSettings,
    status: Mutex<BuildStatus>,
}

impl BuildRunner {
    pub fn new(settings: BuildSettings) -> Arc<Self> {
        Arc::new(Self {
            settings,
            status: Mutex::new(BuildStatus {
                state: BuildState::Idle,
                started_at: None,
                finished_at: None,
                detail: None,
            }),
        })
    }

    pub fn status(&self) -> BuildStatus {
        self.status
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// Start a build in the background. `false` when one is already running.
    pub fn start(self: &Arc<Self>) -> bool {
        {
            let mut status = self.status.lock().unwrap_or_else(PoisonError::into_inner);
            if status.state == BuildState::Running {
                return false;
            }
            *status = BuildStatus {
                state: BuildState::Running,
                started_at: Some(timestamp(now_seconds())),
                finished_at: None,
                detail: None,
            };
        }
        let runner = Arc::clone(self);
        let spawned = std::thread::Builder::new()
            .name("address-build".to_owned())
            .spawn(move || {
                let result = run_build(&runner.settings);
                let mut status = runner.status.lock().unwrap_or_else(PoisonError::into_inner);
                status.finished_at = Some(timestamp(now_seconds()));
                match result {
                    Ok(outcome) => {
                        eprintln!(
                            "address: published build {} with {} addresses",
                            outcome.pointer.build, outcome.pointer.document_count
                        );
                        status.state = BuildState::Idle;
                        status.detail = None;
                    }
                    Err(BuildFailure(detail)) => {
                        eprintln!("address: build failed: {detail}");
                        status.state = BuildState::Failed;
                        status.detail = Some(detail);
                    }
                }
            });
        if spawned.is_err() {
            let mut status = self.status.lock().unwrap_or_else(PoisonError::into_inner);
            status.state = BuildState::Failed;
            status.finished_at = Some(timestamp(now_seconds()));
            status.detail = Some("the build thread could not be started".to_owned());
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listing(source: &str, layer: &str, name: &str, job: Option<u64>) -> SourceListing {
        SourceListing {
            source: source.to_owned(),
            layer: layer.to_owned(),
            name: name.to_owned(),
            job,
        }
    }

    #[test]
    fn only_united_states_address_layers_with_a_job_are_selected() {
        let selection = select_sources(vec![
            listing("us/nc/wake", "addresses", "county", Some(1)),
            listing("us/nc/wake", "parcels", "county", Some(2)),
            listing("ca/on/toronto", "addresses", "city", Some(3)),
            listing("us/nv/clark", "addresses", "county", Some(4)),
            listing("us/nv/never_run", "addresses", "county", None),
            listing("us/countrywide", "addresses", "country", Some(5)),
        ]);
        assert_eq!(selection.source_count(), 2);
        assert_eq!(selection.by_partition[&Partition::South][0].state, "NC");
        assert_eq!(selection.by_partition[&Partition::West][0].job, 4);
        assert!(selection.excluded.is_empty());
    }

    #[test]
    fn the_exclusion_register_matches_source_and_layer_name() {
        let selection = select_sources(vec![
            listing("us/mi/semcog", "addresses", "county", Some(1)),
            listing("us/mi/semcog", "addresses", "condos", Some(2)),
            listing("us/mi/semcog", "addresses", "other", Some(3)),
            listing("us/wa/spokane", "addresses", "county", Some(4)),
        ]);
        assert_eq!(selection.source_count(), 1);
        assert_eq!(selection.by_partition[&Partition::Midwest][0].name, "other");
        assert_eq!(selection.excluded.len(), 3);
        assert!(selection.excluded[2].reason.contains("non-commercial"));
    }

    #[test]
    fn every_exclusion_names_a_reason() {
        for exclusion in LICENCE_EXCLUSIONS {
            assert!(exclusion.source.starts_with("us/"));
            assert!(!exclusion.name.is_empty());
            assert!(!exclusion.reason.is_empty());
        }
    }

    #[test]
    fn a_build_identifier_never_reuses_a_kept_one() {
        let base = build_identifier(1_790_910_909);
        assert_eq!(fresh_build_identifier(1_790_910_909, &[]), base);
        assert_eq!(
            fresh_build_identifier(1_790_910_909, &[base.as_str()]),
            format!("{base}-1")
        );
    }
}
