//! Querying splits.
//!
//! A keyword query runs over one or more splits and returns BM25-ranked hits. Each hit carries the
//! stored ids (never the body — that is re-read from R2) and the score, so the app-Worker side can fuse
//! keyword hits with the semantic half by reciprocal rank and hydrate the survivors through the
//! data-access layer.
//!
//! **[`SplitSearcher`] is the entry point a resident process should use.** Opening a split is not free:
//! it reads the footer, the index metadata, and every segment's header before a single term is looked
//! up, and through a range reader each of those is a separate read. A searcher pays that once and
//! answers any number of queries afterwards, which is the shape a warm Container has and the shape the
//! sub-second target is stated against. The free functions below build a searcher, ask it one question,
//! and throw it away; they are the convenient path for a one-shot caller and for tests, not the path a
//! query server should take.
//!
//! Cross-split scoring caveat: BM25 weights a term by its rarity, which each split knows only within
//! itself. Querying splits independently and merging by score is therefore an approximation — good
//! enough for a ranked review queue, and the reason compaction (fewer, larger splits) improves ranking
//! as well as latency. Global term statistics across splits are a later refinement, not needed to make
//! search correct.

use tantivy::collector::TopDocs;
use tantivy::query::{BooleanQuery, Occur, Query, QueryParser, TermQuery};
use tantivy::schema::{IndexRecordOption, Value};
use tantivy::{Index, IndexReader, TantivyDocument, Term};

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

/// One split, opened once and held open.
///
/// Construction does all the fixed work — resolving the footer, opening the index, building the reader
/// and its segment readers. [`SplitSearcher::search`] then costs only the postings the query walks. Hold
/// one per live split for as long as that split is live; splits are immutable, so a searcher can never
/// go stale, and a split leaving the live set is a catalog change the holder learns about there.
///
/// A searcher also carries its split's **excluded document ids**. A compacted split covers a set of
/// document versions, and a version re-indexed or withdrawn since the merge must stop matching before
/// the next compaction physically removes it. The exclusion belongs to the split rather than to the
/// query because the same document is legitimately live in a different split at a newer version —
/// excluding it globally would hide the current text along with the stale text.
pub struct SplitSearcher {
    index: Index,
    reader: IndexReader,
    schema: SearchSchema,
    excluded_documents: Vec<String>,
}

impl std::fmt::Debug for SplitSearcher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SplitSearcher")
            .field("excluded_documents", &self.excluded_documents.len())
            .finish()
    }
}

impl SplitSearcher {
    /// Open a searcher over a split served through a range reader — the production shape, where the
    /// split lives in R2 and only the bytes a query walks are fetched.
    pub fn over_reader(reader: Arc<dyn RangeReader>) -> Result<Self, SearchError> {
        Self::from_index(open_index(reader)?)
    }

    /// Open a searcher over a split already held in memory.
    pub fn over_split(split: &[u8]) -> Result<Self, SearchError> {
        Self::from_index(open_split(split)?)
    }

    fn from_index(index: Index) -> Result<Self, SearchError> {
        let reader = index.reader()?;
        Ok(Self {
            index,
            reader,
            schema: SearchSchema::build(),
            excluded_documents: Vec::new(),
        })
    }

    /// Name the document ids whose passages this split must not return. Applied to every subsequent
    /// search, so the caller sets it once from the catalog rather than passing it per query.
    #[must_use]
    pub fn excluding_documents(mut self, document_ids: &[String]) -> Self {
        self.excluded_documents = document_ids.to_vec();
        self
    }

    /// The top `limit` hits in this split matching `query_text` over the body field.
    pub fn search(&self, query_text: &str, limit: usize) -> Result<Vec<Hit>, SearchError> {
        let searcher = self.reader.searcher();
        let mut query_parser = QueryParser::for_index(&self.index, vec![self.schema.body()]);
        // A pattern over the words of the index, which is how the application asks for a word that is
        // still being typed: the query language's own prefix form needs two words, so one unfinished
        // word arrives as `body:/word.*/`. The application is the only caller and builds the pattern from
        // letters and digits alone, so no reader's text is ever read as a pattern.
        query_parser.allow_regexes();
        let parsed = query_parser
            .parse_query(query_text)
            .map_err(|error| SearchError::QueryParse(error.to_string()))?;
        let query = self.with_exclusions(parsed);

        let top = searcher.search(&query, &TopDocs::with_limit(limit.max(1)).order_by_score())?;
        let mut hits = Vec::with_capacity(top.len());
        for (score, doc_address) in top {
            let document: TantivyDocument = searcher.doc(doc_address)?;
            hits.push(Hit {
                document_id: stored_text(&document, self.schema.document_id()),
                chunk_id: stored_text(&document, self.schema.chunk_id()),
                score,
            });
        }
        Ok(hits)
    }

    /// Wrap the parsed query so no excluded document can contribute a hit. `document_id` is an
    /// untokenized STRING field, so each exclusion is one exact term — never a prefix or a token of a
    /// longer identifier.
    fn with_exclusions(&self, parsed: Box<dyn Query>) -> Box<dyn Query> {
        if self.excluded_documents.is_empty() {
            return parsed;
        }
        let mut clauses: Vec<(Occur, Box<dyn Query>)> = vec![(Occur::Must, parsed)];
        for document_id in &self.excluded_documents {
            let term = Term::from_field_text(self.schema.document_id(), document_id);
            clauses.push((
                Occur::MustNot,
                Box::new(TermQuery::new(term, IndexRecordOption::Basic)),
            ));
        }
        Box::new(BooleanQuery::new(clauses))
    }
}

/// Search a single split for the top `limit` hits matching `query_text` over the body field. Opens the
/// split, asks once, discards it — see [`SplitSearcher`] for the path that keeps it open.
pub fn query_split(split: &[u8], query_text: &str, limit: usize) -> Result<Vec<Hit>, SearchError> {
    SplitSearcher::over_split(split)?.search(query_text, limit)
}

/// Search a split served through a [`RangeReader`]. The result is identical to [`query_split`] over the
/// same split; the difference is that this reads kilobytes of a large split instead of all of it.
pub fn query_over_reader(
    reader: Arc<dyn RangeReader>,
    query_text: &str,
    limit: usize,
) -> Result<Vec<Hit>, SearchError> {
    SplitSearcher::over_reader(reader)?.search(query_text, limit)
}

/// Search across several already-open searchers and merge to the top `limit` hits overall — the
/// multi-split query path in the shape a resident query server holds it, with each split's own
/// exclusions applied.
pub fn query_searchers(
    searchers: &[SplitSearcher],
    query_text: &str,
    limit: usize,
) -> Result<Vec<Hit>, SearchError> {
    let mut hits: Vec<Hit> = Vec::new();
    for searcher in searchers {
        hits.extend(searcher.search(query_text, limit)?);
    }
    Ok(merge_ranked(hits, limit))
}

/// Search across several splits served through range readers — the production multi-split read shape,
/// where nothing is materialized and every read is a range GET.
///
/// This is what a query over an uncompacted corpus costs: one open plus one postings walk per split,
/// which is why the read count grows with the split count and why compaction is what bounds it.
pub fn query_splits_over_readers(
    readers: &[Arc<dyn RangeReader>],
    query_text: &str,
    limit: usize,
) -> Result<Vec<Hit>, SearchError> {
    let searchers = readers
        .iter()
        .map(|reader| SplitSearcher::over_reader(reader.clone()))
        .collect::<Result<Vec<SplitSearcher>, SearchError>>()?;
    query_searchers(&searchers, query_text, limit)
}

/// Search across several splits held in memory and merge to the top `limit` hits overall.
pub fn query_splits(
    splits: &[&[u8]],
    query_text: &str,
    limit: usize,
) -> Result<Vec<Hit>, SearchError> {
    let mut hits: Vec<Hit> = Vec::new();
    for split in splits {
        hits.extend(query_split(split, query_text, limit)?);
    }
    Ok(merge_ranked(hits, limit))
}

/// Highest score first, then a stable tiebreak on ids so equal-scored hits order deterministically
/// across runs. One home for the merge, so every multi-split path ranks identically.
fn merge_ranked(mut hits: Vec<Hit>, limit: usize) -> Vec<Hit> {
    hits.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.document_id.cmp(&b.document_id))
            .then_with(|| a.chunk_id.cmp(&b.chunk_id))
    });
    hits.truncate(limit);
    hits
}

fn stored_text(document: &TantivyDocument, field: tantivy::schema::Field) -> String {
    document
        .get_first(field)
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_owned()
}
