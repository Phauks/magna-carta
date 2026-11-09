// ZIP and 7z encoders. Each streams its entries into an archive written to a seekable sink (the temp
// file the handler spools to) — the whole archive never lives in memory. The encryption password is used
// only here and is never logged or persisted.
use crate::contract::{Compression, Encryption};
use std::io::{Read, Seek, Write};

#[derive(Debug)]
pub enum EncodeError {
    Zip(zip::result::ZipError),
    Io(std::io::Error),
    SevenZip(String),
}
impl std::fmt::Display for EncodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EncodeError::Zip(e) => write!(f, "zip encode error: {e}"),
            EncodeError::Io(e) => write!(f, "io error: {e}"),
            EncodeError::SevenZip(m) => write!(f, "7z encode error: {m}"),
        }
    }
}
impl std::error::Error for EncodeError {}

/// One archive entry's content as a reader, with its destination path and original modified time.
pub struct LocalEntry {
    pub archive_path: String,
    pub mtime_epoch_secs: Option<i64>,
    pub reader: Box<dyn Read + Send>,
}
impl LocalEntry {
    pub fn from_bytes(path: &str, mtime: Option<i64>, bytes: Vec<u8>) -> Self {
        LocalEntry {
            archive_path: path.to_string(),
            mtime_epoch_secs: mtime,
            reader: Box::new(std::io::Cursor::new(bytes)),
        }
    }
}

fn zip_options<'a>(
    compression: Compression,
    encryption: Option<&'a Encryption>,
    mtime_epoch_secs: Option<i64>,
) -> zip::write::FileOptions<'a, 'static, ()> {
    use zip::write::FileOptions;
    let mut options = FileOptions::default().large_file(true); // ZIP64 always
    options = match compression {
        Compression::Store => options.compression_method(zip::CompressionMethod::Stored),
        Compression::Normal => options.compression_method(zip::CompressionMethod::Deflated),
        Compression::Maximum => options
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(9)),
    };
    if let Some(secs) = mtime_epoch_secs {
        if let Some(dt) = epoch_to_zip_datetime(secs) {
            options = options.last_modified_time(dt);
        }
    }
    if let Some(enc) = encryption {
        options = options.with_aes_encryption(zip::AesMode::Aes256, &enc.password);
    }
    options
}

/// Streams each entry into a ZIP written to `out` (a seekable sink — the temp file). ZIP64 is forced on
/// so large/many-file bundles are always valid; AES-256 encrypts contents when requested (ZIP-AES never
/// hides file names — that is the format, not a choice). Original timestamps are preserved when supplied.
pub fn encode_zip(
    entries: impl Iterator<Item = LocalEntry>,
    compression: Compression,
    encryption: Option<&Encryption>,
    out: &mut (impl Write + Seek),
) -> Result<(), EncodeError> {
    let mut writer = zip::ZipWriter::new(out);
    for mut entry in entries {
        let options = zip_options(compression, encryption, entry.mtime_epoch_secs);
        writer
            .start_file(&entry.archive_path, options)
            .map_err(EncodeError::Zip)?;
        std::io::copy(&mut entry.reader, &mut writer).map_err(EncodeError::Io)?;
    }
    writer.finish().map_err(EncodeError::Zip)?;
    Ok(())
}

/// Converts a Unix epoch to the ZIP `DateTime`. Returns None for times the DOS-derived ZIP format cannot
/// represent (before 1980 / after 2107); the caller then omits the timestamp rather than failing.
fn epoch_to_zip_datetime(secs: i64) -> Option<zip::DateTime> {
    let odt = time::OffsetDateTime::from_unix_timestamp(secs).ok()?;
    // `from_unix_timestamp` is UTC, so the naive (offset-dropped) datetime is the correct wall clock.
    let naive = time::PrimitiveDateTime::new(odt.date(), odt.time());
    zip::DateTime::try_from(naive).ok()
}

/// Streams each entry into a 7z written to `out` (a seekable sink — the temp file; 7z backpatches its
/// start header on finish, so the sink must seek). Content is compressed with LZMA2 and, when requested,
/// encrypted with AES-256; the method chain is AES-then-LZMA2 (compress, then encrypt), and header
/// encryption (which hides the file list) is enabled iff `encrypt_file_names` is set. Original timestamps
/// are preserved when supplied. The password is used only here and is never logged.
pub fn encode_7z(
    entries: impl Iterator<Item = LocalEntry>,
    compression: Compression,
    encryption: Option<&Encryption>,
    out: &mut (impl Write + Seek),
) -> Result<(), EncodeError> {
    use sevenz_rust2::lzma::LZMA2Options;
    use sevenz_rust2::{
        AesEncoderOptions, Password, SevenZArchiveEntry, SevenZMethod, SevenZMethodConfiguration,
        SevenZWriter,
    };

    let mut writer = SevenZWriter::new(out).map_err(|e| EncodeError::SevenZip(e.to_string()))?;
    // The content method. Store → COPY (genuine no-compression, matching ZIP's Stored — the right
    // choice for already-compressed inputs); Normal/Maximum → LZMA2 preset 5/9.
    let content_method: SevenZMethodConfiguration = match compression {
        Compression::Store => SevenZMethodConfiguration::new(SevenZMethod::COPY),
        Compression::Normal => LZMA2Options::with_preset(5).into(),
        Compression::Maximum => LZMA2Options::with_preset(9).into(),
    };
    // Order matters: AES is pushed BEFORE the content method so content is compressed (or stored) and
    // then encrypted.
    let mut methods = Vec::new();
    if let Some(enc) = encryption {
        methods.push(AesEncoderOptions::new(Password::from(enc.password.as_str())).into());
        writer.set_encrypt_header(enc.encrypt_file_names);
    } else {
        writer.set_encrypt_header(false);
    }
    methods.push(content_method);
    writer.set_content_methods(methods);

    for entry in entries {
        let mut meta = SevenZArchiveEntry::new_file(&entry.archive_path);
        if let Some(secs) = entry.mtime_epoch_secs {
            if let Some(ft) = epoch_to_file_time(secs) {
                meta.last_modified_date = ft;
                meta.has_last_modified_date = true;
            }
        }
        writer
            .push_archive_entry(meta, Some(entry.reader))
            .map_err(|e| EncodeError::SevenZip(e.to_string()))?;
    }
    writer
        .finish()
        .map_err(|e| EncodeError::SevenZip(e.to_string()))?;
    Ok(())
}

/// Converts a Unix epoch to the 7z `FileTime` (Windows FILETIME). Returns None for pre-1970 times or any
/// value the conversion rejects; the caller then omits the timestamp rather than failing.
fn epoch_to_file_time(epoch_secs: i64) -> Option<sevenz_rust2::nt_time::FileTime> {
    let secs: u64 = epoch_secs.try_into().ok()?;
    let system_time = std::time::UNIX_EPOCH.checked_add(std::time::Duration::from_secs(secs))?;
    sevenz_rust2::nt_time::FileTime::try_from(system_time).ok()
}
