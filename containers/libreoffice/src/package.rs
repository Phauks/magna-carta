//! The job package: a per-conversion directory on the container disk holding a manifest and one or
//! more files.
//!
//! Today every package holds exactly one file — the source document. The shape is a package rather
//! than a body from the start because the email render path writes `message.html` plus a
//! `resources/` subdirectory of extracted content-identifier parts into the same directory and
//! changes nothing else: the worker protocol, the directory lifecycle, the deadline, the recycle
//! policy, and the crash path are all identical.
//!
//! Packages live on the container **disk**, never a tmpfs, specifically so a large document
//! consumes disk budget rather than the memory budget the workers are sized against.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::dispatch::Recipe;
use crate::protocol::JobManifest;

/// The file the package writes its manifest to. The worker does not read it — the supervisor sends
/// the manifest down the pipe — but it is written because the manifest is part of the package
/// format, and a package left behind by a hard crash should be self-describing to whoever finds it.
pub const MANIFEST_FILE_NAME: &str = "manifest.json";

static NEXT_JOB_NUMBER: AtomicU64 = AtomicU64::new(0);

/// A materialised conversion job.
///
/// The directory is removed when this value is dropped, which is what makes "removed on every exit
/// path, including the crash path" true by construction rather than by remembering: the handler
/// holds the package across the pool call, so a deadline, a worker fault, a panic caught by the
/// panic net, and an ordinary success all run the same removal.
pub struct JobPackage {
    directory: PathBuf,
    manifest: JobManifest,
}

impl JobPackage {
    /// Materialise a single-document package under `spool_directory`.
    pub fn create(
        spool_directory: &Path,
        source_bytes: &[u8],
        recipe: &Recipe,
    ) -> std::io::Result<Self> {
        let job_number = NEXT_JOB_NUMBER.fetch_add(1, Ordering::Relaxed);
        // Job names only need to be unique inside this container, and a counter is exactly that
        // without reaching for an identifier crate. The process identifier keeps two supervisors
        // sharing a spool directory (only ever a test arrangement) from colliding.
        let directory =
            spool_directory.join(format!("job-{}-{job_number:012}", std::process::id()));
        std::fs::create_dir_all(&directory)?;

        let entry_document = format!("source.{}", recipe.source_extension);
        let output_document = format!("output.{}", recipe.output_extension);
        std::fs::write(directory.join(&entry_document), source_bytes)?;

        let manifest = JobManifest {
            entry_document,
            save_format: recipe.save_format.to_owned(),
            filter: recipe.filter.to_owned(),
            output_document,
            attachment_policy: None,
        };
        // Serialising a manifest of owned strings cannot fail; treat a failure as an I/O fault
        // rather than unwrapping, so no request path can panic on it.
        let encoded = serde_json::to_vec_pretty(&manifest).map_err(std::io::Error::other)?;
        std::fs::write(directory.join(MANIFEST_FILE_NAME), encoded)?;

        Ok(Self {
            directory,
            manifest,
        })
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    pub fn manifest(&self) -> &JobManifest {
        &self.manifest
    }

    /// The output document the worker was asked to write.
    pub fn output_path(&self) -> PathBuf {
        self.directory.join(&self.manifest.output_document)
    }

    /// Read the converted bytes back.
    ///
    /// `Ok(None)` means the worker reported success and produced nothing readable. That is a fault,
    /// not a result: the caller must never turn it into a 200 with an empty body.
    pub fn read_output(&self) -> std::io::Result<Option<Vec<u8>>> {
        let path = self.output_path();
        match std::fs::read(&path) {
            Ok(bytes) if bytes.is_empty() => Ok(None),
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }
}

impl Drop for JobPackage {
    fn drop(&mut self) {
        // Best-effort by necessity: there is no caller left to report to. A directory that survives
        // is bounded by the instance's disk and swept by the next boot, whereas a panic here would
        // take out the supervisor.
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

/// Clear anything left in the spool directory at start-up. A supervisor that was killed mid-job
/// leaves a package behind — nothing else can, because the drop guard runs on every other path.
pub fn sweep_spool(spool_directory: &Path) -> std::io::Result<()> {
    if !spool_directory.exists() {
        std::fs::create_dir_all(spool_directory)?;
        return Ok(());
    }
    for entry in std::fs::read_dir(spool_directory)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            std::fs::remove_dir_all(entry.path())?;
        } else {
            std::fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dispatch::recipe_for;

    fn temporary_spool(label: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "magna-carta-libreoffice-package-{label}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        directory
    }

    #[test]
    fn a_package_holds_the_source_and_a_self_describing_manifest() {
        let spool = temporary_spool("create");
        let recipe = recipe_for("docx", "pdf", "pdf").unwrap();
        let package = JobPackage::create(&spool, b"source bytes", &recipe).unwrap();

        assert_eq!(package.manifest().entry_document, "source.docx");
        assert_eq!(package.manifest().output_document, "output.pdf");
        assert_eq!(package.manifest().filter, "writer_pdf_Export");

        let entry = package.directory().join("source.docx");
        assert_eq!(std::fs::read(entry).unwrap(), b"source bytes");

        let written: JobManifest = serde_json::from_slice(
            &std::fs::read(package.directory().join(MANIFEST_FILE_NAME)).unwrap(),
        )
        .unwrap();
        assert_eq!(&written, package.manifest());

        let _ = std::fs::remove_dir_all(&spool);
    }

    #[test]
    fn the_job_directory_is_removed_when_the_package_is_dropped() {
        let spool = temporary_spool("drop");
        let recipe = recipe_for("docx", "odt", "odt").unwrap();
        let directory = {
            let package = JobPackage::create(&spool, b"x", &recipe).unwrap();
            let directory = package.directory().to_path_buf();
            assert!(directory.exists());
            directory
        };
        assert!(
            !directory.exists(),
            "the job directory must not outlive the package"
        );
        let _ = std::fs::remove_dir_all(&spool);
    }

    #[test]
    fn a_missing_output_is_reported_as_nothing_rather_than_empty_bytes() {
        let spool = temporary_spool("missing-output");
        let recipe = recipe_for("odt", "pdf", "pdf").unwrap();
        let package = JobPackage::create(&spool, b"x", &recipe).unwrap();
        assert_eq!(package.read_output().unwrap(), None);
        let _ = std::fs::remove_dir_all(&spool);
    }

    #[test]
    fn a_zero_length_output_is_reported_as_nothing_rather_than_empty_bytes() {
        let spool = temporary_spool("empty-output");
        let recipe = recipe_for("odt", "pdf", "pdf").unwrap();
        let package = JobPackage::create(&spool, b"x", &recipe).unwrap();
        std::fs::write(package.output_path(), b"").unwrap();
        assert_eq!(package.read_output().unwrap(), None);
        let _ = std::fs::remove_dir_all(&spool);
    }

    #[test]
    fn a_written_output_reads_back() {
        let spool = temporary_spool("output");
        let recipe = recipe_for("odt", "pdf", "pdf").unwrap();
        let package = JobPackage::create(&spool, b"x", &recipe).unwrap();
        std::fs::write(package.output_path(), b"%PDF-1.7\n").unwrap();
        assert_eq!(package.read_output().unwrap(), Some(b"%PDF-1.7\n".to_vec()));
        let _ = std::fs::remove_dir_all(&spool);
    }

    #[test]
    fn concurrent_packages_never_share_a_directory() {
        let spool = temporary_spool("unique");
        let recipe = recipe_for("docx", "pdf", "pdf").unwrap();
        let first = JobPackage::create(&spool, b"a", &recipe).unwrap();
        let second = JobPackage::create(&spool, b"b", &recipe).unwrap();
        assert_ne!(first.directory(), second.directory());
        let _ = std::fs::remove_dir_all(&spool);
    }

    #[test]
    fn the_spool_sweep_clears_a_package_left_by_a_killed_supervisor() {
        let spool = temporary_spool("sweep");
        let orphan = spool.join("job-orphan");
        std::fs::create_dir_all(orphan.join("resources")).unwrap();
        std::fs::write(orphan.join("source.docx"), b"x").unwrap();
        sweep_spool(&spool).unwrap();
        assert!(spool.exists());
        assert_eq!(std::fs::read_dir(&spool).unwrap().count(), 0);
        let _ = std::fs::remove_dir_all(&spool);
    }

    #[test]
    fn the_spool_sweep_creates_the_directory_when_it_is_absent() {
        let spool = std::env::temp_dir().join(format!(
            "magna-carta-libreoffice-package-absent-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&spool);
        sweep_spool(&spool).unwrap();
        assert!(spool.exists());
        let _ = std::fs::remove_dir_all(&spool);
    }
}
