// The OPC part names and patterns the inspect and scrub modules both need, in one place so a part
// can never be scrubbed without being inspected (a silent pass) or inspected without being scrubbed
// (a report that never goes clean).

export const CONTENT_TYPES_PART = "[Content_Types].xml";
export const CORE_PART = "docProps/core.xml";
export const APP_PART = "docProps/app.xml";
export const CUSTOM_PROPERTIES_PART = "docProps/custom.xml";
export const SETTINGS_PART = "word/settings.xml";

// A rendered preview of the document's first page, written by the authoring application when
// "save thumbnail" is on. It is a picture, so it is untouched by every XML transform in this
// package — including the ones that removed the tracked changes and hidden text it still shows.
export const THUMBNAIL_PART_PATTERN = /^docProps\/thumbnail\.[^/]+$/;

// Custom XML data parts and everything under them (their properties and relationships). Word keeps
// arbitrary caller-supplied XML here; in practice it is where a document-management system stores
// its client, matter, and author record, which travels with the file.
export const CUSTOM_XML_PART_PATTERN = /^customXml\//;

// Reviewer comments and their satellite parts. commentsExtended carries the reply threading and
// resolved state, commentsIds the durable comment identifiers, commentsExtensible the per-comment
// timestamps, and people.xml the reviewer names and provider identities.
export const COMMENT_PART_PATTERN =
  /^word\/(comments|commentsExtended|commentsIds|commentsExtensible|people)\.xml$/;

// Any relationship part, in any directory — including the package-root "_rels/.rels", whose file
// name is nothing but the extension.
export const RELS_PART_PATTERN = /(^|\/)_rels\/[^/]*\.rels$/;

// The top-level word-processing parts (document, styles, numbering, settings, fonts, web settings).
export const WORD_PART_PATTERN = /^word\/[^/]+\.xml$/;

// Revision save identifiers as ELEMENTS: the w:rsids list in settings.xml and the per-style w:rsid
// in styles.xml. The same identifiers also appear as w:rsid* ATTRIBUTES on content elements — see
// revisionSaveIdentifierAttributeNames in walk.ts.
export const EDIT_HISTORY_TAGS: ReadonlySet<string> = new Set(["w:rsid", "w:rsids"]);

// settings.xml children removed with the identifying metadata: the mail-merge configuration (its
// data source is regularly a network path naming a client or matter) and the attached-template
// reference.
export const SETTINGS_TAGS_IDENTIFYING: readonly string[] = ["w:mailMerge", "w:attachedTemplate"];

// settings.xml children removed with the custom properties: document variables, an arbitrary
// name/value store that automation and templates leave data in.
export const SETTINGS_TAGS_CUSTOM: readonly string[] = ["w:docVars"];

// The marker substring that identifies a revision save identifier in raw part text. Inspect scans
// for it rather than parsing every word-processing part on a read-only pass.
export const REVISION_SAVE_IDENTIFIER_MARKER = "w:rsid";

export function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}
