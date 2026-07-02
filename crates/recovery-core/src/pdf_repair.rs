//! The PDF cross-reference rebuild pillar: scan the raw bytes for the indirect
//! objects still physically present, synthesize a fresh classic xref + trailer,
//! reload through lopdf, and re-emit a clean PDF — recording every object that
//! could not be re-parsed as lost. Diagnose PDF xref corruption.
