//! The discovery keyword-index schema.
//!
//! One schema, versioned, shared by every split so a query can open splits built at different times
//! as one index. The fields are deliberately minimal: the index carries the *searchable* text and the
//! identifiers needed to hydrate a hit back through the data-access layer — never the document's full
//! content, which lives in R2 (the "bulk content to R2, never the index" rule the design follows).

use tantivy::schema::{Field, Schema, INDEXED, STORED, STRING, TEXT};

/// The schema generation. A split records the generation it was built with; a query refuses to open a
/// split whose generation it does not understand, so a schema change never silently mixes incompatible
/// splits (the "index generation gates schema changes" rule in the design). Bump on any field change.
pub const SCHEMA_GENERATION: u32 = 1;

/// The resolved schema plus typed handles to its fields, so call sites never look fields up by string.
#[derive(Clone)]
pub struct SearchSchema {
    schema: Schema,
    document_id: Field,
    chunk_id: Field,
    body: Field,
}

impl SearchSchema {
    /// Build the one canonical schema. Deterministic — the same field order every time, so two splits
    /// built independently share a byte-comparable schema.
    pub fn build() -> Self {
        let mut builder = Schema::builder();
        // The document this text came from — stored so a hit can name it, and a string (untokenized)
        // so an exact-id lookup or a delete-by-id matches the whole identifier, not a token of it.
        let document_id = builder.add_text_field("document_id", STRING | STORED);
        // The passage/page within the document (the semantic half chunks the same way). Stored so a hit
        // points at the exact passage, not just the document.
        let chunk_id = builder.add_text_field("chunk_id", STRING | STORED);
        // The searchable text. TEXT = tokenized and positional (positions are what phrase and proximity
        // queries need). Not stored: the passage text is re-read from R2 for display, so storing it in
        // the index too would duplicate the doc-store for no query benefit.
        let body = builder.add_text_field("body", TEXT);
        // `INDEXED` is referenced so the import is used even before more field types land; kept explicit
        // to document that every searchable field must opt into indexing.
        let _ = INDEXED;
        let schema = builder.build();
        Self {
            schema,
            document_id,
            chunk_id,
            body,
        }
    }

    pub fn schema(&self) -> &Schema {
        &self.schema
    }

    pub fn document_id(&self) -> Field {
        self.document_id
    }

    pub fn chunk_id(&self) -> Field {
        self.chunk_id
    }

    pub fn body(&self) -> Field {
        self.body
    }
}

impl Default for SearchSchema {
    fn default() -> Self {
        Self::build()
    }
}
