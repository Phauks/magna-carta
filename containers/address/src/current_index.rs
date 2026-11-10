//! The open index a query container answers from, and when it is reopened.
//!
//! The four partitions are opened lazily, on the first query, from whatever the pointer names, and kept
//! open across requests. The pointer is re-read at most once per interval (ten minutes in production);
//! the partitions are reopened only when the build id it names has changed, so a re-read that finds the
//! same build costs one small GET and nothing else.
//!
//! A reload never stalls queries that already have an index: one request does the reload while the
//! rest keep answering from the index they have. Only when there is no index at all do requests wait,
//! because there is nothing else to answer from.

use std::sync::atomic::AtomicUsize;
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use address_core::{AddressEngine, Partition, PartitionIndex};

use crate::object_client::{CachedRangeReader, HttpRangeReader, ObjectStore, RangeCache};
use crate::pointer::{pointer_key, Pointer};

/// How often a container with an index re-reads the pointer.
pub const POINTER_INTERVAL: Duration = Duration::from_secs(10 * 60);
/// How often a container with NO index re-reads it: sooner, so the first build to publish is picked up
/// without a ten-minute wait, but not on every keystroke.
pub const POINTER_INTERVAL_WITHOUT_INDEX: Duration = Duration::from_secs(60);

/// One build's partitions, open.
#[derive(Debug)]
pub struct LoadedIndex {
    pub build: String,
    pub engine: AddressEngine,
}

#[derive(Default)]
struct HolderState {
    loaded: Option<Arc<LoadedIndex>>,
    checked_at: Option<Instant>,
}

enum Refresh {
    /// The pointer names the build already open.
    Unchanged,
    /// A different build, now open.
    Replaced(Arc<LoadedIndex>),
    /// No pointer: nothing is published.
    Missing,
    /// The pointer or a partition could not be read; keep what is open.
    Failed,
}

#[derive(Debug, Clone, Copy)]
pub struct HolderIntervals {
    pub with_index: Duration,
    pub without_index: Duration,
}

impl Default for HolderIntervals {
    fn default() -> Self {
        Self {
            with_index: POINTER_INTERVAL,
            without_index: POINTER_INTERVAL_WITHOUT_INDEX,
        }
    }
}

pub struct IndexHolder {
    store: ObjectStore,
    cache: Arc<RangeCache>,
    intervals: HolderIntervals,
    state: Mutex<HolderState>,
    reloading: Mutex<()>,
    /// Range requests that left the process, across every partition ever opened.
    reads: Arc<AtomicUsize>,
}

impl std::fmt::Debug for IndexHolder {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("IndexHolder")
            .finish_non_exhaustive()
    }
}

impl IndexHolder {
    pub fn new(store: ObjectStore, cache: Arc<RangeCache>, intervals: HolderIntervals) -> Self {
        Self {
            store,
            cache,
            intervals,
            state: Mutex::new(HolderState::default()),
            reloading: Mutex::new(()),
            reads: Arc::new(AtomicUsize::new(0)),
        }
    }

    pub fn ranged_reads(&self) -> usize {
        self.reads.load(std::sync::atomic::Ordering::Relaxed)
    }

    pub fn cache(&self) -> &Arc<RangeCache> {
        &self.cache
    }

    fn snapshot(&self) -> (Option<Arc<LoadedIndex>>, bool) {
        let state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        let interval = if state.loaded.is_some() {
            self.intervals.with_index
        } else {
            self.intervals.without_index
        };
        let due = state
            .checked_at
            .is_none_or(|checked| checked.elapsed() >= interval);
        (state.loaded.clone(), due)
    }

    /// The index to answer from, re-reading the pointer when it is due. `None` when nothing is published
    /// or nothing could be opened. Blocking: call from a blocking task.
    pub fn current(&self) -> Option<Arc<LoadedIndex>> {
        let (loaded, due) = self.snapshot();
        if !due {
            return loaded;
        }
        let _reload = if loaded.is_some() {
            match self.reloading.try_lock() {
                Ok(guard) => guard,
                // Another request is reloading; answer from the index already open.
                Err(_) => return loaded,
            }
        } else {
            self.reloading
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
        };
        // Someone may have reloaded while this request waited.
        let (loaded, due) = self.snapshot();
        if !due {
            return loaded;
        }
        let refresh = self.refresh(loaded.as_deref());
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        state.checked_at = Some(Instant::now());
        match refresh {
            Refresh::Unchanged | Refresh::Failed => {}
            Refresh::Replaced(index) => state.loaded = Some(index),
            Refresh::Missing => state.loaded = None,
        }
        state.loaded.clone()
    }

    fn refresh(&self, loaded: Option<&LoadedIndex>) -> Refresh {
        let pointer = match self.store.get_small(&pointer_key()) {
            Ok(Some(bytes)) => match serde_json::from_slice::<Pointer>(&bytes) {
                Ok(pointer) => pointer,
                Err(_) => {
                    eprintln!("address: the index pointer is malformed");
                    return Refresh::Failed;
                }
            },
            Ok(None) => return Refresh::Missing,
            Err(error) => {
                eprintln!("address: the index pointer could not be read: {error}");
                return Refresh::Failed;
            }
        };
        if loaded.is_some_and(|index| index.build == pointer.build) {
            return Refresh::Unchanged;
        }
        match self.open(&pointer) {
            Ok(engine) => Refresh::Replaced(Arc::new(LoadedIndex {
                build: pointer.build,
                engine,
            })),
            Err(error) => {
                eprintln!("address: the published index could not be opened: {error}");
                Refresh::Failed
            }
        }
    }

    /// Open every partition the pointer names, in parallel: each open is a HEAD and a few reads, and
    /// four in a row would quadruple the first query's wait.
    fn open(&self, pointer: &Pointer) -> Result<AddressEngine, String> {
        let mut keys = Vec::with_capacity(Partition::ALL.len());
        for partition in Partition::ALL {
            let key = pointer
                .partitions
                .get(partition.name())
                .ok_or_else(|| "the pointer is missing a partition".to_owned())?;
            keys.push((partition, key.as_str()));
        }
        let opened: Vec<Result<PartitionIndex, String>> = thread::scope(|scope| {
            let handles: Vec<_> = keys
                .iter()
                .map(|(partition, key)| {
                    scope.spawn(move || {
                        let reader = HttpRangeReader::open(&self.store, key, self.reads.clone())
                            .map_err(|error| error.to_string())?;
                        let cached = CachedRangeReader::new(reader, self.cache.clone());
                        PartitionIndex::open(*partition, Arc::new(cached))
                            .map_err(|error| error.to_string())
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| {
                    handle
                        .join()
                        .unwrap_or_else(|_| Err("a partition open stopped".to_owned()))
                })
                .collect()
        });
        let partitions = opened.into_iter().collect::<Result<Vec<_>, _>>()?;
        Ok(AddressEngine::new(partitions))
    }
}
