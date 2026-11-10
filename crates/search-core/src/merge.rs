//! Merging many splits into one — the engine half of index compaction.
//!
//! The write pipeline publishes one split per document version, because that is what makes a re-index
//! converge on the same object rather than accumulate copies. The read path pays for that shape
//! directly: a query is handed every live split the catalog holds and reads each one's footer, index
//! metadata, term dictionary, and postings separately, so the per-query read count grows with the split
//! COUNT rather than with the corpus. Merging the same documents into one split collapses all of that
//! into a single set of reads over a single term dictionary.
//!
//! The merge is a **segment-level** merge, not a re-index. That is not an optimization, it is the only
//! option available: the schema indexes `body` without storing it (the passage text lives in R2, not in
//! the index), so the documents cannot be read back out of a split and re-added. Tantivy merging the
//! source segments directly preserves the inverted index without ever needing the original text, and it
//! is also the cheaper operation — postings lists are concatenated and remapped rather than retokenized.
//!
//! **Deletions are applied during the merge.** A merged split covers a set of document versions, and a
//! version that has since been re-indexed or withdrawn must stop matching. Passing those document ids as
//! exclusions deletes them from the merged index and repacks it, so the superseded postings are
//! physically gone from the published bytes rather than filtered on the way out.

use std::collections::BTreeSet;
use std::sync::Arc;

use tantivy::directory::MmapDirectory;
use tantivy::indexer::merge_indices;
use tantivy::schema::Value;
use tantivy::{Index, TantivyDocument, Term};

use crate::directory::{open_index, RangeReader};
use crate::error::SearchError;
use crate::schema::{register_tokenizers, SearchSchema};
use crate::split::{bundle_directory, open_split};

/// What a merge produced: the split's bytes, and the facts the caller records in its catalog without
/// having to re-open what it just wrote.
#[derive(Clone, Debug)]
pub struct MergedSplit {
    pub bytes: Vec<u8>,
    /// Live documents in the merged split — the sum of the sources minus everything excluded. This is
    /// the count the catalog row carries, so it must come from the merged index rather than from adding
    /// up the sources, which would over-count every exclusion.
    pub document_count: u64,
    /// The document ids the merge actually removed, out of those it was asked to remove. An id that
    /// appeared in no source split is not an error — a compaction and a re-index can legitimately race,
    /// leaving an exclusion for a document whose split had already left the merge set — but the
    /// difference is worth reporting rather than swallowing.
    pub excluded: Vec<String>,
}

/// The indexing heap for the repack pass that follows a deletion. Deleting does not itself build
/// postings, and the repack streams the surviving documents, so this only has to be large enough for
/// Tantivy to work in; it is a fraction of the split builder's budget.
const MERGE_WRITER_HEAP_BYTES: usize = 20_000_000;

/// Merge splits served through range readers into one split — the production compaction path.
///
/// Each source is opened through its own reader, so the merge streams the bytes it needs out of the
/// objects rather than materializing whole splits. `exclude_document_ids` names document ids whose
/// postings must not survive into the result.
pub fn merge_splits_over_readers(
    readers: &[Arc<dyn RangeReader>],
    exclude_document_ids: &[String],
) -> Result<MergedSplit, SearchError> {
    if readers.is_empty() {
        return Err(SearchError::NothingToMerge);
    }
    let indices = readers
        .iter()
        .map(|reader| open_index(reader.clone()))
        .collect::<Result<Vec<Index>, SearchError>>()?;
    merge_opened(&indices, exclude_document_ids)
}

/// Merge in-memory splits into one. The result is identical to [`merge_splits_over_readers`] over the
/// same splits; this entry point exists for tests and for a caller that already holds the bytes.
pub fn merge_splits(
    splits: &[&[u8]],
    exclude_document_ids: &[String],
) -> Result<MergedSplit, SearchError> {
    if splits.is_empty() {
        return Err(SearchError::NothingToMerge);
    }
    let indices = splits
        .iter()
        .map(|split| open_split(split))
        .collect::<Result<Vec<Index>, SearchError>>()?;
    merge_opened(&indices, exclude_document_ids)
}

fn merge_opened(
    indices: &[Index],
    exclude_document_ids: &[String],
) -> Result<MergedSplit, SearchError> {
    let scratch = tempfile::tempdir()?;
    let output = MmapDirectory::open(scratch.path())?;
    // The merged index names the body's analyzer like every other, so it is registered here too: the
    // repack below opens a writer on it, and an index that names an analyzer it does not hold is one
    // a later change could trip over.
    let merged = register_tokenizers(merge_indices(indices, output)?);

    let excluded = if exclude_document_ids.is_empty() {
        Vec::new()
    } else {
        apply_exclusions(&merged, exclude_document_ids)?
    };

    // Only the files the merged index's own metadata declares live. Applying deletions leaves the
    // pre-deletion segment behind in the scratch directory, and it is dead the moment the repack
    // commits; asking Tantivy which files are live is the one answer that cannot drift from the truth.
    let live = live_file_names(&merged)?;
    let document_count = merged.reader()?.searcher().num_docs();
    let bytes = bundle_directory(scratch.path(), document_count, &|name| live.contains(name))?;

    Ok(MergedSplit {
        bytes,
        document_count,
        excluded,
    })
}

/// Delete the excluded documents from the merged index and repack it, so their postings leave the
/// published bytes rather than being filtered out of every future query.
///
/// The two steps are both necessary and they do different things. `delete_term` + `commit` marks the
/// documents dead, which is what makes them stop matching. The merge that follows rewrites the segment
/// without them, which is what makes the split smaller and keeps a query from walking postings that can
/// never contribute a hit. Stopping after the first step would be correct and would leave compaction
/// unable to reclaim anything a re-index superseded.
fn apply_exclusions(
    index: &Index,
    exclude_document_ids: &[String],
) -> Result<Vec<String>, SearchError> {
    let schema = SearchSchema::build();
    let present = document_ids_present(index, exclude_document_ids)?;
    if present.is_empty() {
        return Ok(Vec::new());
    }

    let mut writer: tantivy::IndexWriter<TantivyDocument> =
        index.writer_with_num_threads(1, MERGE_WRITER_HEAP_BYTES)?;
    for document_id in &present {
        // `document_id` is an untokenized STRING field, so the term is the whole identifier and the
        // delete matches every passage of that document exactly — never a passage of a document whose
        // id merely shares a token with it.
        writer.delete_term(Term::from_field_text(schema.document_id(), document_id));
    }
    writer.commit()?;

    let segment_ids = index.searchable_segment_ids()?;
    if !segment_ids.is_empty() {
        writer.merge(&segment_ids).wait()?;
    }
    writer.wait_merging_threads()?;

    Ok(present.into_iter().collect())
}

/// Which of the requested exclusions actually appear in the merged index. Read once, up front: a
/// delete for a document that is not there is harmless but would still cost a commit and a repack of an
/// index nothing changed in, and the caller is owed the honest list of what was removed.
fn document_ids_present(
    index: &Index,
    candidates: &[String],
) -> Result<BTreeSet<String>, SearchError> {
    let wanted: BTreeSet<&str> = candidates.iter().map(String::as_str).collect();
    let schema = SearchSchema::build();
    let searcher = index.reader()?.searcher();
    let mut present = BTreeSet::new();
    for segment_reader in searcher.segment_readers() {
        let store = segment_reader.get_store_reader(0)?;
        for document_id in 0..segment_reader.max_doc() {
            if segment_reader.is_deleted(document_id) {
                continue;
            }
            let document: TantivyDocument = store.get(document_id)?;
            let Some(value) = document
                .get_first(schema.document_id())
                .and_then(|value| value.as_str())
            else {
                continue;
            };
            if wanted.contains(value) {
                present.insert(value.to_owned());
            }
        }
    }
    Ok(present)
}

/// Every file the index's live segments and its metadata depend on. `IndexMeta::list_segment_files` names
/// the files each segment *may* have, so this is a superset of what is on disk; the bundler intersects it with
/// what it actually finds.
fn live_file_names(index: &Index) -> Result<BTreeSet<String>, SearchError> {
    let mut names: BTreeSet<String> = BTreeSet::new();
    // The index-level files. `meta.json` is how a reader finds the segments at all; the managed-files
    // record rides along so a merged split has the same shape on disk as a built one.
    names.insert("meta.json".to_owned());
    names.insert(".managed.json".to_owned());
    for path in index.load_metas()?.list_segment_files() {
        if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
            names.insert(name.to_owned());
        }
    }
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{build_split, query_split, read_footer, IndexDocument, SCHEMA_GENERATION};

    fn passage(document_id: &str, chunk: usize, body: &str) -> IndexDocument {
        IndexDocument {
            document_id: document_id.to_owned(),
            chunk_id: format!("{document_id}:p{chunk}"),
            body: body.to_owned(),
        }
    }

    /// One split per document, the shape the write pipeline publishes.
    fn per_document_splits(documents: usize) -> Vec<Vec<u8>> {
        (0..documents)
            .map(|index| {
                let identifier = format!("doc-{index}");
                let mut passages = vec![passage(
                    &identifier,
                    1,
                    "the parties agree to the terms set forth in this agreement",
                )];
                if index == 0 {
                    passages.push(passage(
                        &identifier,
                        2,
                        "the seller shall indemnify the buyer against zzzuniquetoken claims",
                    ));
                }
                build_split(&passages).unwrap()
            })
            .collect()
    }

    fn borrow(splits: &[Vec<u8>]) -> Vec<&[u8]> {
        splits.iter().map(Vec::as_slice).collect()
    }

    #[test]
    fn merging_preserves_every_document_and_every_match() {
        let splits = per_document_splits(12);
        let merged = merge_splits(&borrow(&splits), &[]).unwrap();

        let footer = read_footer(&merged.bytes).unwrap();
        assert_eq!(footer.schema_generation, SCHEMA_GENERATION);
        assert_eq!(
            footer.document_count, 13,
            "12 documents, one with 2 passages"
        );
        assert_eq!(merged.document_count, 13);

        // Every document the sources held still matches the term they all share.
        let common = query_split(&merged.bytes, "agreement", 100).unwrap();
        assert_eq!(common.len(), 12);
        // And the term that lived in exactly one source split still resolves to it.
        let unique = query_split(&merged.bytes, "zzzuniquetoken", 10).unwrap();
        assert_eq!(unique.len(), 1);
        assert_eq!(unique[0].document_id, "doc-0");
        assert_eq!(unique[0].chunk_id, "doc-0:p2");
    }

    #[test]
    fn a_merged_split_holds_one_segment() {
        // The whole point of merging: a query consults every segment's term dictionary, so a merge that
        // left the sources as separate segments would move the fan-out from the split count to the
        // segment count and buy nothing.
        let splits = per_document_splits(20);
        let merged = merge_splits(&borrow(&splits), &[]).unwrap();
        let footer = read_footer(&merged.bytes).unwrap();
        let segments: BTreeSet<&str> = footer
            .files
            .iter()
            .map(|file| file.name.as_str())
            .filter(|name| !name.starts_with('.') && *name != "meta.json")
            .filter_map(|name| name.split('.').next())
            .collect();
        assert_eq!(
            segments.len(),
            1,
            "a merge must produce one segment, got {segments:?}"
        );
    }

    #[test]
    fn an_excluded_document_stops_matching_and_leaves_the_bytes() {
        let splits = per_document_splits(12);
        let excluded = vec!["doc-0".to_owned()];
        let merged = merge_splits(&borrow(&splits), &excluded).unwrap();

        assert_eq!(merged.excluded, vec!["doc-0".to_owned()]);
        assert_eq!(merged.document_count, 11, "doc-0's two passages are gone");

        let unique = query_split(&merged.bytes, "zzzuniquetoken", 10).unwrap();
        assert!(
            unique.is_empty(),
            "the excluded document's only distinctive term must not match"
        );
        let common = query_split(&merged.bytes, "agreement", 100).unwrap();
        assert_eq!(common.len(), 11);
        assert!(
            common.iter().all(|hit| hit.document_id != "doc-0"),
            "no passage of an excluded document may survive"
        );

        let footer = read_footer(&merged.bytes).unwrap();
        assert_eq!(footer.document_count, 11);
        // Deleted documents are repacked out, not merely masked: the merged split carries a single
        // segment whose files hold 11 documents, so nothing is paying to walk the dead postings.
        let segments: BTreeSet<&str> = footer
            .files
            .iter()
            .map(|file| file.name.as_str())
            .filter(|name| !name.starts_with('.') && *name != "meta.json")
            .filter_map(|name| name.split('.').next())
            .collect();
        assert_eq!(segments.len(), 1);
    }

    #[test]
    fn an_exclusion_for_a_document_that_is_not_there_is_reported_not_refused() {
        // A compaction and a re-index can legitimately race: by the time the merge runs, the document's
        // split may already have left the merge set. That must not fail the pass.
        let splits = per_document_splits(4);
        let merged = merge_splits(&borrow(&splits), &["doc-999".to_owned()]).unwrap();
        assert!(merged.excluded.is_empty());
        assert_eq!(merged.document_count, 5);
    }

    #[test]
    fn merging_nothing_is_refused() {
        assert!(matches!(
            merge_splits(&[], &[]).unwrap_err(),
            SearchError::NothingToMerge
        ));
    }

    #[test]
    fn a_merged_split_is_smaller_than_the_splits_it_replaces() {
        // The size claim behind compaction: per-split fixed overhead (metadata, term dictionary, footer)
        // is paid once instead of once per document.
        let splits = per_document_splits(50);
        let separate: usize = splits.iter().map(Vec::len).sum();
        let merged = merge_splits(&borrow(&splits), &[]).unwrap();
        assert!(
            merged.bytes.len() < separate,
            "merged {} bytes should be under the {separate} bytes of 50 separate splits",
            merged.bytes.len()
        );
    }

    #[test]
    fn merging_through_range_readers_matches_merging_in_memory() {
        use crate::directory::RangeReader;
        use std::io;

        #[derive(Debug)]
        struct SliceReader(Vec<u8>);
        impl RangeReader for SliceReader {
            fn read_range(&self, offset: usize, length: usize) -> io::Result<Vec<u8>> {
                let end = offset
                    .checked_add(length)
                    .filter(|end| *end <= self.0.len())
                    .ok_or_else(|| {
                        io::Error::new(io::ErrorKind::UnexpectedEof, "range past end")
                    })?;
                Ok(self.0[offset..end].to_vec())
            }
            fn total_len(&self) -> usize {
                self.0.len()
            }
        }

        let splits = per_document_splits(8);
        let readers: Vec<Arc<dyn RangeReader>> = splits
            .iter()
            .map(|split| Arc::new(SliceReader(split.clone())) as Arc<dyn RangeReader>)
            .collect();

        let ranged = merge_splits_over_readers(&readers, &[]).unwrap();
        let in_memory = merge_splits(&borrow(&splits), &[]).unwrap();
        assert_eq!(ranged.document_count, in_memory.document_count);
        assert_eq!(
            query_split(&ranged.bytes, "agreement", 100).unwrap().len(),
            query_split(&in_memory.bytes, "agreement", 100)
                .unwrap()
                .len()
        );
    }
}
