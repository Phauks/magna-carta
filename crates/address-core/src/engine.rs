//! Answering: suggestions and units over the opened partitions.
//!
//! Every partition is a split read by range, so the cost that matters is round trips, not CPU. Three
//! things keep a keystroke to a few:
//!
//! - **The partitions are searched in parallel.** Four partitions cost one round trip, not four.
//! - **A query's terms are resolved in parallel before it runs.** Tantivy resolves terms one after
//!   another — a term-info read, then a postings read, per term — so a five-term query against cold
//!   storage is ten round trips in a row. [`prefetch_terms`] reads them all at once first, which makes
//!   it two, and the query then finds every block in the reader's cache. This assumes the reader
//!   caches what it served, as the query container's does; over a reader that does not, each term is
//!   simply read twice.
//! - **Stored rows are fetched in parallel.** Tantivy reads stored rows one at a time; a sequential
//!   fetch of eight rows was measured as the whole of the slow tail. Each row an answer needs is
//!   fetched on its own thread, so they cost one round trip together.
//!
//! An answer is built in score order and rows are fetched only as far as the answer needs: a batch of
//! as many rows as entries are still missing, then, if rows collapsed into groups, a wider batch.

use std::collections::HashMap;
use std::sync::Arc;
use std::thread;

use search_core::{RangeReader, SplitDirectory};
use tantivy::collector::{Count, TopDocs};
use tantivy::query::Query;
use tantivy::schema::{IndexRecordOption, Value};
use tantivy::{DocAddress, Index, ReloadPolicy, Score, Searcher, TantivyDocument, Term};

use crate::address::{natural_order, Address, Building, Offer};
use crate::error::AddressError;
use crate::partition::Partition;
use crate::query::{building_query, normalise_building, parse_query, suggestion_query};
use crate::schema::{register_analyzers, AddressSchema};

/// The answer size when the caller names none.
pub const DEFAULT_LIMIT: usize = 8;
/// The largest answer a caller may ask for.
pub const MAXIMUM_LIMIT: usize = 10;
/// Hits taken from each partition before merging. Enough that collapsing a building's units into one
/// group still leaves a full answer, small enough that ranking them costs nothing.
pub const HITS_PER_PARTITION: usize = 64;
/// The most units a building opens into.
pub const MAXIMUM_UNITS: usize = 200;
/// Threads fetching the rows of a units answer. A building's rows sit together in the store, so a few
/// threads reach them all; more would only race each other for the same blocks.
const UNIT_FETCH_THREADS: usize = 8;
/// How much wider than the entries still missing a follow-up row batch is. Rows that collapse into a
/// group are usually neighbours in the store, so a wide batch costs few extra reads and saves a round
/// trip per batch it replaces.
const FOLLOW_UP_BATCH_FACTOR: usize = 8;

/// Read the term info and postings of every term in `query`, all at once, so the query that follows is
/// served from the reader's cache. Errors are ignored here: the query itself reads the same bytes and
/// reports them.
fn prefetch_terms(searcher: &Searcher, query: &dyn Query) {
    let mut terms: Vec<Term> = Vec::new();
    query.query_terms(&mut |term, _| {
        if !terms.contains(term) {
            terms.push(term.clone());
        }
    });
    if terms.len() < 2 {
        return;
    }
    thread::scope(|scope| {
        for term in &terms {
            scope.spawn(move || {
                for segment in searcher.segment_readers() {
                    if let Ok(inverted_index) = segment.inverted_index(term.field()) {
                        let _ = inverted_index.read_postings(term, IndexRecordOption::Basic);
                    }
                }
            });
        }
    });
}

/// One opened partition: a searcher held open over its split.
pub struct PartitionIndex {
    partition: Partition,
    searcher: Searcher,
    schema: AddressSchema,
}

impl std::fmt::Debug for PartitionIndex {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PartitionIndex")
            .field("partition", &self.partition)
            .field("documents", &self.searcher.num_docs())
            .finish()
    }
}

impl PartitionIndex {
    /// Open a partition's split through `reader`. Reads the footer and the index's metadata; postings
    /// and rows are read later, per query.
    pub fn open(partition: Partition, reader: Arc<dyn RangeReader>) -> Result<Self, AddressError> {
        let directory = SplitDirectory::open(reader)?;
        let index = Index::open(directory)?;
        register_analyzers(&index);
        let schema = AddressSchema::from_schema(&index.schema())?;
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        Ok(Self {
            partition,
            searcher: reader.searcher(),
            schema,
        })
    }

    pub fn partition(&self) -> Partition {
        self.partition
    }

    pub fn document_count(&self) -> u64 {
        self.searcher.num_docs()
    }

    fn read_row(&self, address: DocAddress) -> Result<Address, AddressError> {
        let document: TantivyDocument = self.searcher.doc(address)?;
        let text = |field| {
            document
                .get_first(field)
                .and_then(|value| value.as_str().map(str::to_owned))
                .unwrap_or_default()
        };
        let number = |field| {
            document
                .get_first(field)
                .and_then(|value| value.as_f64())
                .unwrap_or_default()
        };
        let schema = &self.schema;
        Ok(Address {
            number: text(schema.number),
            street: text(schema.street),
            unit: text(schema.unit),
            city: text(schema.city),
            region: text(schema.region),
            postcode: text(schema.postcode),
            longitude: number(schema.longitude),
            latitude: number(schema.latitude),
        })
    }

    fn count_building(&self, building: &Building) -> Result<u64, AddressError> {
        let Some(query) = building_query(&self.schema, building) else {
            return Ok(0);
        };
        prefetch_terms(&self.searcher, &*query);
        Ok(self.searcher.search(&*query, &Count)? as u64)
    }

    fn building_rows(&self, building: &Building) -> Result<Vec<DocAddress>, AddressError> {
        let Some(query) = building_query(&self.schema, building) else {
            return Ok(Vec::new());
        };
        prefetch_terms(&self.searcher, &*query);
        let hits = self.searcher.search(
            &*query,
            &TopDocs::with_limit(MAXIMUM_UNITS).order_by_score(),
        )?;
        let mut addresses: Vec<DocAddress> = hits.into_iter().map(|(_, address)| address).collect();
        // In store order, so the threads fetching them walk neighbouring blocks.
        addresses.sort();
        Ok(addresses)
    }
}

/// One hit from one partition, in the merged ranking.
#[derive(Clone, Copy)]
struct RankedHit<'a> {
    score: Score,
    order: usize,
    partition: &'a PartitionIndex,
    address: DocAddress,
}

/// A building or address on its way into the answer.
struct Candidate<'a> {
    partition: &'a PartitionIndex,
    first: Address,
    has_unit_row: bool,
}

/// The opened partitions, answering together.
#[derive(Debug)]
pub struct AddressEngine {
    partitions: Vec<PartitionIndex>,
}

fn join<T>(
    handle: thread::ScopedJoinHandle<'_, Result<T, AddressError>>,
) -> Result<T, AddressError> {
    handle.join().map_err(|_| AddressError::WorkerStopped)?
}

/// Fetch rows concurrently, at most `threads` at a time, keeping the order of `targets`.
fn fetch_rows(
    targets: &[(&PartitionIndex, DocAddress)],
    threads: usize,
) -> Result<Vec<Address>, AddressError> {
    if targets.is_empty() {
        return Ok(Vec::new());
    }
    let chunk = targets.len().div_ceil(threads.max(1)).max(1);
    thread::scope(|scope| {
        let handles: Vec<_> = targets
            .chunks(chunk)
            .map(|group| {
                scope.spawn(move || {
                    group
                        .iter()
                        .map(|(partition, address)| partition.read_row(*address))
                        .collect::<Result<Vec<_>, _>>()
                })
            })
            .collect();
        let mut rows = Vec::with_capacity(targets.len());
        for handle in handles {
            rows.extend(join(handle)?);
        }
        Ok(rows)
    })
}

impl AddressEngine {
    pub fn new(partitions: Vec<PartitionIndex>) -> Self {
        Self { partitions }
    }

    pub fn partitions(&self) -> &[PartitionIndex] {
        &self.partitions
    }

    pub fn document_count(&self) -> u64 {
        self.partitions
            .iter()
            .map(PartitionIndex::document_count)
            .sum()
    }

    /// Suggestions for typed text: at most `limit` (clamped to 1..=10) addresses and groups, best first.
    /// `near` is a region code whose addresses are ranked first, never the only ones offered.
    pub fn suggest(
        &self,
        text: &str,
        limit: usize,
        near: Option<&str>,
    ) -> Result<Vec<Offer>, AddressError> {
        let limit = limit.clamp(1, MAXIMUM_LIMIT);
        let Some(parsed) = parse_query(text) else {
            return Ok(Vec::new());
        };
        let near = near.map(str::trim).filter(|region| !region.is_empty());

        let per_partition: Vec<Vec<(Score, DocAddress)>> = thread::scope(|scope| {
            let handles: Vec<_> = self
                .partitions
                .iter()
                .map(|partition| {
                    let parsed = &parsed;
                    scope.spawn(move || {
                        let query = suggestion_query(&partition.schema, parsed, near);
                        prefetch_terms(&partition.searcher, &*query);
                        Ok(partition.searcher.search(
                            &*query,
                            &TopDocs::with_limit(HITS_PER_PARTITION).order_by_score(),
                        )?)
                    })
                })
                .collect();
            handles.into_iter().map(join).collect::<Result<Vec<_>, _>>()
        })?;

        let mut hits: Vec<RankedHit<'_>> = self
            .partitions
            .iter()
            .zip(per_partition)
            .enumerate()
            .flat_map(|(order, (partition, found))| {
                found.into_iter().map(move |(score, address)| RankedHit {
                    score,
                    order,
                    partition,
                    address,
                })
            })
            .collect();
        // Best score first; ties in partition order, then store order, so an answer is deterministic.
        hits.sort_by(|left, right| {
            right
                .score
                .total_cmp(&left.score)
                .then(left.order.cmp(&right.order))
                .then(left.address.cmp(&right.address))
        });

        let candidates = self.collapse(&hits, limit)?;
        self.offers(candidates)
    }

    /// Walk the ranking, fetching rows only as far as the answer needs, and collapse rows of the same
    /// building into one candidate.
    fn collapse<'a>(
        &'a self,
        hits: &[RankedHit<'a>],
        limit: usize,
    ) -> Result<Vec<Candidate<'a>>, AddressError> {
        let mut candidates: Vec<Candidate<'a>> = Vec::with_capacity(limit);
        let mut positions: HashMap<Building, usize> = HashMap::new();
        let mut cursor = 0;
        while candidates.len() < limit && cursor < hits.len() {
            let missing = limit - candidates.len();
            let wanted = if cursor == 0 {
                missing
            } else {
                missing * FOLLOW_UP_BATCH_FACTOR
            };
            let take = wanted.min(hits.len() - cursor);
            let batch = hits.get(cursor..cursor + take).unwrap_or_default();
            cursor += take;
            let targets: Vec<(&PartitionIndex, DocAddress)> = batch
                .iter()
                .map(|hit| (hit.partition, hit.address))
                .collect();
            let rows = fetch_rows(&targets, targets.len())?;
            for (hit, row) in batch.iter().zip(rows) {
                let building = row.building();
                if let Some(candidate) = positions
                    .get(&building)
                    .and_then(|position| candidates.get_mut(*position))
                {
                    candidate.has_unit_row |= !row.unit.is_empty();
                } else if candidates.len() < limit {
                    positions.insert(building, candidates.len());
                    candidates.push(Candidate {
                        partition: hit.partition,
                        has_unit_row: !row.unit.is_empty(),
                        first: row,
                    });
                }
            }
        }
        Ok(candidates)
    }

    /// Turn candidates into offers. A building with a unit row among the hits is counted exactly; with
    /// more than one row it is a group, otherwise the row itself is the address.
    fn offers(&self, candidates: Vec<Candidate<'_>>) -> Result<Vec<Offer>, AddressError> {
        let counts: Vec<Option<u64>> = thread::scope(|scope| {
            let handles: Vec<_> = candidates
                .iter()
                .map(|candidate| {
                    candidate.has_unit_row.then(|| {
                        scope.spawn(move || {
                            candidate
                                .partition
                                .count_building(&candidate.first.building())
                        })
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.map(join).transpose())
                .collect::<Result<Vec<_>, _>>()
        })?;
        Ok(candidates
            .into_iter()
            .zip(counts)
            .map(|(candidate, count)| match count {
                Some(count) if count > 1 => {
                    let building = candidate.first.building();
                    Offer::Group {
                        label: building.label(),
                        count,
                        building,
                    }
                }
                _ => Offer::Address {
                    label: candidate.first.label(),
                    address: candidate.first,
                },
            })
            .collect())
    }

    /// Every unit of a building (at most 200), the building's own row first and units in natural order.
    pub fn units(&self, building: &Building) -> Result<Vec<Address>, AddressError> {
        let building = normalise_building(building);
        if building.number.is_empty() || building.street.is_empty() {
            return Ok(Vec::new());
        }
        // The building's own partition when it is open; every partition otherwise, so a building in a
        // region this engine does not map still resolves.
        let home = Partition::for_state(&building.region);
        let mut chosen: Vec<&PartitionIndex> = self
            .partitions
            .iter()
            .filter(|partition| partition.partition == home)
            .collect();
        if chosen.is_empty() {
            chosen = self.partitions.iter().collect();
        }
        let found: Vec<Vec<DocAddress>> = thread::scope(|scope| {
            let handles: Vec<_> = chosen
                .iter()
                .map(|partition| {
                    let building = &building;
                    scope.spawn(move || partition.building_rows(building))
                })
                .collect();
            handles.into_iter().map(join).collect::<Result<Vec<_>, _>>()
        })?;
        let targets: Vec<(&PartitionIndex, DocAddress)> = chosen
            .iter()
            .zip(found)
            .flat_map(|(partition, addresses)| {
                addresses
                    .into_iter()
                    .map(move |address| (*partition, address))
            })
            .take(MAXIMUM_UNITS)
            .collect();
        let mut rows: Vec<Address> = fetch_rows(&targets, UNIT_FETCH_THREADS)?
            .into_iter()
            // The index matched words; the answer must be this building exactly.
            .filter(|row| row.building() == building)
            .collect();
        rows.sort_by(|left, right| natural_order(&left.unit, &right.unit));
        Ok(rows)
    }
}
