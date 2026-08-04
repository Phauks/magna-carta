//! Querying splits.
//!
//! A keyword query runs over one or more splits and returns BM25-ranked hits. Each hit carries the
//! stored ids (never the body — that is re-read from R2) and the score, so the app-Worker side can fuse
//! keyword hits with the semantic half by reciprocal rank and hydrate the survivors through the
//! data-access layer.
//!
//! Cross-split scoring caveat: BM25 weights a term by its rarity, which each split knows only within
//! itself. Querying splits independently and merging by score is therefore an approximation — good
//! enough for a ranked review queue, and the reason compaction (fewer, larger splits) improves ranking
//! as well as latency. Global term statistics across splits are a later refinement, not needed to make
//! search correct.

use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::Value;
use tantivy::{Index, TantivyDocument};

use std::sync::Arc;

use crate::directory::{open_index, RangeReader};
use crate::error::SearchError;
use crate::schema::SearchSchema;
use crate::split::open_split;

/// One ranked result: the pointers needed to hydrate the passage, and the engine score.
#[derive(Clone, Debug, PartialEq)]
pub struct Hit {
    pub document_id: String,
    pub chunk_id: String,
    pub score: f32,
}

/// Search a single split for the top `limit` hits matching `query_text` over the body field.
pub fn query_split(split: &[u8], query_text: &str, limit: usize) -> Result<Vec<Hit>, SearchError> {
    let index = open_split(split)?;
    search_index(&index, query_text, limit)
}

/// Search a split served through a [`RangeReader`] — the production path, where the index lives in R2
/// and only the bytes the query walks are fetched. The result is identical to [`query_split`] over the
/// same split; the difference is that this reads kilobytes of a large split instead of all of it.
pub fn query_over_reader(
    reader: Arc<dyn RangeReader>,
    query_text: &str,
    limit: usize,
) -> Result<Vec<Hit>, SearchError> {
    let index = open_index(reader)?;
    search_index(&index, query_text, limit)
}

/// Search across several splits and merge to the top `limit` hits overall. This is the moderate-scale
/// query path in miniature: one reader per split, merge by score. The R2 slice keeps this shape and
/// adds footer-pruning (skip a split whose terms exclude the query) and ranged reads (fetch only the
/// postings touched) — the merge over survivors is unchanged.
pub fn query_splits(
    splits: &[&[u8]],
    query_text: &str,
    limit: usize,
) -> Result<Vec<Hit>, SearchError> {
    let mut hits: Vec<Hit> = Vec::new();
    for split in splits {
        hits.extend(query_split(split, query_text, limit)?);
    }
    // Merge: highest score first, then a stable tiebreak on ids so equal-scored hits order
    // deterministically across runs.
    hits.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.document_id.cmp(&b.document_id))
            .then_with(|| a.chunk_id.cmp(&b.chunk_id))
    });
    hits.truncate(limit);
    Ok(hits)
}

fn search_index(index: &Index, query_text: &str, limit: usize) -> Result<Vec<Hit>, SearchError> {
    let schema = SearchSchema::build();
    let reader = index.reader()?;
    let searcher = reader.searcher();

    let query_parser = QueryParser::for_index(index, vec![schema.body()]);
    let query = query_parser
        .parse_query(query_text)
        .map_err(|error| SearchError::QueryParse(error.to_string()))?;

    let top = searcher.search(&query, &TopDocs::with_limit(limit.max(1)).order_by_score())?;
    let mut hits = Vec::with_capacity(top.len());
    for (score, doc_address) in top {
        let document: TantivyDocument = searcher.doc(doc_address)?;
        let document_id = stored_text(&document, schema.document_id());
        let chunk_id = stored_text(&document, schema.chunk_id());
        hits.push(Hit {
            document_id,
            chunk_id,
            score,
        });
    }
    Ok(hits)
}

fn stored_text(document: &TantivyDocument, field: tantivy::schema::Field) -> String {
    document
        .get_first(field)
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_owned()
}
