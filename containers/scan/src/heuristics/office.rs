use super::Heuristic;
use cfb::CompoundFile;
use std::io::Cursor;

/// Inspects an OLE/CFB Office file — legacy `.doc`/`.xls`/`.ppt`, or the CFB wrapper an encrypted OOXML
/// document is stored in — for an encrypted package (blocks inspection) or VBA macros (active content).
/// An unparseable OLE is `Clean` here (clamd and yara still scan the bytes).
pub fn inspect_ole(bytes: &[u8]) -> Heuristic {
    let comp = match CompoundFile::open(Cursor::new(bytes)) {
        Ok(comp) => comp,
        Err(_) => return Heuristic::Clean,
    };
    // Encrypted OOXML (MS-OFFCRYPTO) is a CFB whose root carries these two streams.
    if comp.is_stream("/EncryptedPackage") && comp.is_stream("/EncryptionInfo") {
        return Heuristic::Encrypted;
    }
    // VBA macros live under a Macros / _VBA_PROJECT_CUR / VBA storage.
    for entry in comp.walk() {
        if entry.is_storage() {
            let name = entry.name().to_ascii_lowercase();
            if name == "macros" || name == "_vba_project_cur" || name == "vba" {
                return Heuristic::ActiveContent;
            }
        }
    }
    Heuristic::Clean
}
