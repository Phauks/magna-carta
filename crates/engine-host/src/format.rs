//! Cheap, growable magic-byte file-type identification shared across engines.
//! Owns ONLY the leading-bytes layer; an engine that needs a richer check
//! composes on top.
