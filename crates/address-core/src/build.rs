//! Building one partition: cleaned addresses in, one Tantivy segment on scratch disk, then streamed out
//! as a `search-core` split.
//!
//! A partition holds millions of addresses, so the build is shaped around disk and memory rather than
//! convenience:
//!
//! - Documents are indexed on several threads (each writes segments of its own), with background
//!   merging switched off — merging while indexing rewrites the same bytes repeatedly — and then merged
//!   ONCE into a single segment at the end. One segment is what keeps a query to one term-dictionary
//!   lookup per word.
//! - The split is never assembled on disk or in memory. [`BuiltPartition::write_split`] streams each
//!   index file, then the footer and trailer, into any `Write`, so a caller can feed it straight into a
//!   multipart upload and the partition never exists twice on the build disk.

use std::fs::File;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use search_core::{FileEntry, Footer};
use tantivy::indexer::NoMergePolicy;
use tantivy::tokenizer::TextAnalyzer;
use tantivy::{Index, IndexWriter, TantivyDocument};

use crate::address::Address;
use crate::error::AddressError;
use crate::schema::{
    analyse_words, push_prefixes, register_analyzers, word_analyzer, AddressSchema,
    ADDRESS_INDEX_GENERATION,
};

/// How a partition is indexed.
#[derive(Clone, Copy, Debug)]
pub struct BuildOptions {
    /// Indexing threads. Each produces segments of its own; they are merged into one at the end.
    pub threads: usize,
    /// The writer's memory budget across all threads, in bytes. Tantivy needs at least 15 MB a thread.
    pub heap_bytes: usize,
}

impl Default for BuildOptions {
    /// Four threads and 2 GB: the build container is four vCPUs with 12 GiB, and the rest of that memory
    /// is the de-duplication key sets and the upload buffer.
    fn default() -> Self {
        Self {
            threads: 4,
            heap_bytes: 2_000_000_000,
        }
    }
}

/// An index being written into a scratch directory.
pub struct PartitionBuilder {
    index: Index,
    writer: IndexWriter<TantivyDocument>,
    schema: AddressSchema,
    directory: PathBuf,
    document_count: u64,
    analyzer: TextAnalyzer,
    words_text: String,
    prefixes_text: String,
}

impl PartitionBuilder {
    /// Start an index in `directory`, which must exist and be empty.
    pub fn create(directory: &Path, options: &BuildOptions) -> Result<Self, AddressError> {
        let schema = AddressSchema::build();
        let index = Index::create_in_dir(directory, schema.schema().clone())?;
        register_analyzers(&index);
        let writer = index.writer_with_num_threads(options.threads.max(1), options.heap_bytes)?;
        writer.set_merge_policy(Box::new(NoMergePolicy));
        Ok(Self {
            index,
            writer,
            schema,
            directory: directory.to_path_buf(),
            document_count: 0,
            analyzer: word_analyzer(),
            words_text: String::new(),
            prefixes_text: String::new(),
        })
    }

    /// Index one cleaned address.
    pub fn add(&mut self, address: &Address) -> Result<(), AddressError> {
        self.words_text.clear();
        for piece in [
            &address.street,
            &address.unit,
            &address.city,
            &address.postcode,
        ] {
            if piece.is_empty() {
                continue;
            }
            if !self.words_text.is_empty() {
                self.words_text.push(' ');
            }
            self.words_text.push_str(piece);
        }
        self.prefixes_text.clear();
        for word in analyse_words(&mut self.analyzer, &self.words_text) {
            push_prefixes(&word, &mut self.prefixes_text);
        }

        let schema = &self.schema;
        let mut document = TantivyDocument::default();
        document.add_text(schema.number, &address.number);
        document.add_text(schema.words, &self.words_text);
        document.add_text(schema.prefixes, &self.prefixes_text);
        document.add_text(schema.region, &address.region);
        document.add_text(schema.street, &address.street);
        // An empty part is left out of the stored row rather than stored as an empty string: most rows
        // have no unit, and a few bytes a row is a measurable share of a 62-byte address.
        for (field, value) in [
            (schema.unit, &address.unit),
            (schema.city, &address.city),
            (schema.postcode, &address.postcode),
        ] {
            if !value.is_empty() {
                document.add_text(field, value);
            }
        }
        document.add_f64(schema.longitude, address.longitude);
        document.add_f64(schema.latitude, address.latitude);
        self.writer.add_document(document)?;
        self.document_count += 1;
        Ok(())
    }

    pub fn document_count(&self) -> u64 {
        self.document_count
    }

    /// Commit, merge every segment into one, and drop the files the merge superseded.
    pub fn finish(self) -> Result<BuiltPartition, AddressError> {
        let PartitionBuilder {
            index,
            mut writer,
            directory,
            document_count,
            ..
        } = self;
        writer.commit()?;
        let segments = index.searchable_segment_ids()?;
        if segments.len() > 1 {
            writer.merge(&segments).wait()?;
        }
        writer.garbage_collect_files().wait()?;
        writer.wait_merging_threads()?;

        let metas = index.searchable_segment_metas()?;
        if metas.len() > 1 {
            return Err(AddressError::IncompatibleIndex(
                "the partition did not merge into one segment",
            ));
        }
        // Exactly the files the index's own metadata says are live, plus the metadata itself. Deciding
        // from the metadata rather than from what is on disk keeps a superseded segment that garbage
        // collection has not yet removed out of the published split.
        let mut files = vec!["meta.json".to_owned()];
        for path in index.load_metas()?.list_segment_files() {
            if let Some(name) = path.to_str() {
                if directory.join(name).is_file() {
                    files.push(name.to_owned());
                }
            }
        }
        files.sort();
        files.dedup();
        Ok(BuiltPartition {
            directory,
            files,
            document_count,
        })
    }
}

/// A finished, single-segment partition index on scratch disk.
#[derive(Debug)]
pub struct BuiltPartition {
    directory: PathBuf,
    files: Vec<String>,
    document_count: u64,
}

impl BuiltPartition {
    pub fn document_count(&self) -> u64 {
        self.document_count
    }

    /// The scratch directory holding the index. The caller owns it and removes it after the upload.
    pub fn directory(&self) -> &Path {
        &self.directory
    }

    /// Stream the partition as a split — each index file in name order, the footer, then the eight-byte
    /// trailer — into `output`, returning the number of bytes written. The format is `search-core`'s,
    /// unchanged, so its `SplitDirectory` opens the result.
    pub fn write_split(&self, output: &mut dyn Write) -> Result<u64, AddressError> {
        let mut offset: usize = 0;
        let mut entries: Vec<FileEntry> = Vec::with_capacity(self.files.len());
        for name in &self.files {
            let mut file = File::open(self.directory.join(name))?;
            let copied = io::copy(&mut file, output)?;
            let length = usize::try_from(copied)
                .map_err(|_| AddressError::IncompatibleIndex("an index file is too large"))?;
            entries.push(FileEntry {
                name: name.clone(),
                offset,
                len: length,
            });
            offset += length;
        }
        let footer = serde_json::to_vec(&Footer {
            schema_generation: ADDRESS_INDEX_GENERATION,
            document_count: self.document_count,
            files: entries,
        })?;
        output.write_all(&footer)?;
        output.write_all(&(footer.len() as u64).to_le_bytes())?;
        output.flush()?;
        Ok((offset + footer.len() + 8) as u64)
    }
}

/// Build a whole partition from `addresses` into `directory` and return the split's bytes. For tests and
/// measurement; the build container streams with [`BuiltPartition::write_split`] instead.
pub fn build_partition_split(
    addresses: impl IntoIterator<Item = Address>,
    directory: &Path,
    options: &BuildOptions,
) -> Result<Vec<u8>, AddressError> {
    let mut builder = PartitionBuilder::create(directory, options)?;
    for address in addresses {
        builder.add(&address)?;
    }
    let built = builder.finish()?;
    let mut bytes = Vec::new();
    built.write_split(&mut bytes)?;
    Ok(bytes)
}
