//! The worker pool: warm, long-lived child processes, one conversion at a time each.
//!
//! Collabora's robustness comes from process-per-job plus a jail: a warm template process forks one
//! child per conversion. We take the isolation and decline the fork. `fork()` from a process running
//! a multi-threaded async runtime is not safe — the child inherits the parent's address space with
//! only the forking thread alive, so any lock another thread held at fork time is held forever — and
//! reproducing that discipline underneath tokio buys a saving we do not need, because a warm worker
//! amortises suite initialisation across its whole lifetime instead of paying it per job.
//!
//! Two properties of the binding are load-bearing rather than incidental, and both appear directly
//! in this file. Its office handle is neither `Send` nor `Sync` and a second concurrent instance in
//! one process segfaults, so **one conversion at a time per worker** is structural, not policy. And
//! creating an instance after destroying one also segfaults, so **recycling is always process
//! replacement** — there is no path here that tears a worker's suite down and rebuilds it in place.
//!
//! The supervisor holds no suite state itself. That is the whole point of putting the consented C++
//! on the far side of a process boundary: a wedged or segfaulting conversion kills its own child and
//! there is no shared structure for it to corrupt.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::BufReader;
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{Mutex, Notify};
use tokio::time::{timeout, timeout_at, Instant};

use crate::package::JobPackage;
use crate::protocol::{
    read_frame, write_frame, FrameError, SupervisorFrame, UnconvertibleCode, WorkerFrame,
};
use crate::resident::resident_kibibytes;

/// How the pool is sized and when it retires a worker.
///
/// The numbers the supervisor defaults to are a defensible starting point, not a measurement: the
/// pool size, the instance type, and the recycle thresholds are re-derived against the load-profile
/// harness once there is a real conversion mix.
#[derive(Debug, Clone)]
pub struct PoolConfiguration {
    /// The worker child binary. Overridden by the tests to point at the fake worker.
    pub worker_binary: PathBuf,
    /// Extra arguments handed to every worker child. Empty in the image; the tests use it to
    /// instruct the fake worker's behaviour.
    pub worker_arguments: Vec<String>,
    /// How many warm workers the pool keeps.
    pub pool_size: usize,
    /// Where each worker's own `UserInstallation` profile lives. A per-worker profile means the
    /// profile-lock contention that breaks concurrent `soffice --convert-to` cannot arise even in
    /// principle.
    pub profile_root: PathBuf,
    /// A profile directory tree copied into each worker's profile before it starts, carrying the
    /// baked security settings. `None` on a host with no baked profile.
    pub profile_template: Option<PathBuf>,
    /// Retire a worker after this many conversions. Segfaults are reported to accumulate across
    /// conversions on newer suite builds, and a bounded lifetime is the cheap answer to a leak we
    /// do not control.
    pub max_conversions_per_worker: u32,
    /// Retire a worker whose resident set exceeds this. A legitimate very large document may be
    /// recycled out from under itself and fail; that is the correct direction to fail in, and it
    /// surfaces as a retryable status rather than a corrupt output.
    pub max_resident_kibibytes: u64,
    /// How long one conversion may run before its child is killed. Sized so that "exceeded" means
    /// wedged, not slow.
    pub conversion_deadline: Duration,
    /// How long a request waits for an idle worker before the pool reports itself busy.
    pub acquire_deadline: Duration,
    /// How long a freshly spawned worker has to finish suite initialisation and report ready.
    pub warm_deadline: Duration,
    /// How often the pool reconciles its population back up to `pool_size` after a failed spawn.
    pub reconcile_interval: Duration,
}

/// Why a conversion did not produce bytes.
#[derive(Debug)]
pub enum PoolError {
    /// No worker could be acquired inside the acquire deadline.
    NoWorkerAvailable,
    /// The conversion exceeded its deadline and its child was killed.
    ConversionDeadline,
    /// The worker died, desynchronised, or answered with something this protocol does not define.
    WorkerFault(String),
    /// The document reached the suite and could not be converted.
    Unconvertible(UnconvertibleCode),
}

impl std::fmt::Display for PoolError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PoolError::NoWorkerAvailable => write!(formatter, "no worker available"),
            PoolError::ConversionDeadline => write!(formatter, "conversion deadline exceeded"),
            PoolError::WorkerFault(detail) => write!(formatter, "worker fault: {detail}"),
            PoolError::Unconvertible(code) => write!(formatter, "unconvertible: {code:?}"),
        }
    }
}

impl std::error::Error for PoolError {}

struct Worker {
    child: Child,
    standard_input: ChildStdin,
    standard_output: BufReader<ChildStdout>,
    conversions: u32,
    profile_directory: PathBuf,
}

impl Worker {
    fn process_identifier(&self) -> Option<u32> {
        self.child.id()
    }

    /// Send one job and read its answer. Cancellation-safe in the only sense that matters here: the
    /// caller wraps this in the conversion deadline and, if that fires, kills the child rather than
    /// reusing a half-read pipe.
    async fn run(
        &mut self,
        package_directory: &Path,
        manifest: crate::protocol::JobManifest,
    ) -> Result<WorkerFrame, FrameError> {
        let frame = SupervisorFrame::Convert {
            package_directory: package_directory.to_string_lossy().into_owned(),
            manifest,
        };
        write_frame(&mut self.standard_input, &frame).await?;
        read_frame(&mut self.standard_output).await
    }
}

/// The pool.
pub struct Pool {
    configuration: PoolConfiguration,
    idle: Mutex<VecDeque<Worker>>,
    available: Notify,
    /// Workers that exist or are being spawned. Held at `pool_size`, and transiently one higher
    /// while a scheduled recycle warms a replacement alongside the worker it will replace.
    population: AtomicUsize,
    /// Workers that have reported suite initialisation complete. `/ready` is this being non-zero.
    warm: AtomicUsize,
    suite_version: Mutex<Option<String>>,
    next_worker_number: AtomicU64,
}

impl Pool {
    /// Build a pool and start filling it in the background.
    ///
    /// Filling is deliberately not awaited: suite initialisation takes tens of seconds, and the HTTP
    /// surface has to be listening before then so `/ready` can answer honestly during the wait
    /// rather than the port simply being closed.
    pub fn start(configuration: PoolConfiguration) -> Arc<Self> {
        let pool = Arc::new(Self {
            configuration,
            idle: Mutex::new(VecDeque::new()),
            available: Notify::new(),
            population: AtomicUsize::new(0),
            warm: AtomicUsize::new(0),
            suite_version: Mutex::new(None),
            next_worker_number: AtomicU64::new(0),
        });
        pool.top_up();
        let reconciler = Arc::clone(&pool);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(reconciler.configuration.reconcile_interval).await;
                reconciler.top_up();
            }
        });
        pool
    }

    pub fn configuration(&self) -> &PoolConfiguration {
        &self.configuration
    }

    /// Whether at least one worker has completed suite initialisation.
    ///
    /// This is the whole substance of the container's `/ready`. Initialisation takes tens of
    /// seconds, and a container that reports ready before it can convert hands that entire delay to
    /// the first user request as an unexplained stall.
    pub fn is_ready(&self) -> bool {
        self.warm.load(Ordering::SeqCst) > 0
    }

    /// The suite version the first worker reported. Provenance: a document converted before and
    /// after an upgrade should be explainably different rather than mysteriously so.
    pub async fn suite_version(&self) -> Option<String> {
        self.suite_version.lock().await.clone()
    }

    /// Wait until a worker can convert, or give up. Used by the tests and by nothing on the request
    /// path — a request that arrives before the pool is warm waits on the acquire deadline instead.
    pub async fn wait_until_ready(&self, within: Duration) -> bool {
        let deadline = Instant::now() + within;
        while Instant::now() < deadline {
            if self.is_ready() {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        self.is_ready()
    }

    /// Convert a materialised package. On success the output document is on disk where the
    /// package's manifest said it would be.
    pub async fn convert(self: &Arc<Self>, package: &JobPackage) -> Result<(), PoolError> {
        let mut worker = self.acquire().await?;
        let outcome = timeout(
            self.configuration.conversion_deadline,
            worker.run(package.directory(), package.manifest().clone()),
        )
        .await;

        match outcome {
            // The deadline fired. Kill this child and only this child, then start a replacement.
            // A worker that dies on its own is indistinguishable from this and is handled the same
            // way, which is why both paths converge on `discard`.
            Err(_elapsed) => {
                self.discard(worker).await;
                Err(PoolError::ConversionDeadline)
            }
            Ok(Err(fault)) => {
                let detail = fault.to_string();
                self.discard(worker).await;
                Err(PoolError::WorkerFault(detail))
            }
            Ok(Ok(WorkerFrame::Converted { resident_kibibytes })) => {
                self.release(worker, resident_kibibytes).await;
                Ok(())
            }
            Ok(Ok(WorkerFrame::Unconvertible { code })) => {
                // The worker is healthy — the document was not. It goes back to serving, but the
                // attempt still counts against its bounded lifetime.
                self.release(worker, 0).await;
                Err(PoolError::Unconvertible(code))
            }
            // A second `Ready` (or anything else out of sequence) means the pipe is desynchronised.
            Ok(Ok(WorkerFrame::Ready { .. })) => {
                self.discard(worker).await;
                Err(PoolError::WorkerFault(
                    "worker answered a job with a readiness frame".to_owned(),
                ))
            }
        }
    }

    async fn acquire(&self) -> Result<Worker, PoolError> {
        let deadline = Instant::now() + self.configuration.acquire_deadline;
        loop {
            // Register interest BEFORE looking at the queue: a worker released between the check
            // and the wait would otherwise notify nobody and this request would wait out its full
            // deadline behind an idle worker.
            let notified = self.available.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();

            if let Some(worker) = self.idle.lock().await.pop_front() {
                return Ok(worker);
            }

            if timeout_at(deadline, notified).await.is_err() {
                return Err(PoolError::NoWorkerAvailable);
            }
        }
    }

    /// Return a healthy worker to service, or retire it if it has reached either ceiling.
    async fn release(self: &Arc<Self>, mut worker: Worker, reported_resident_kibibytes: u64) {
        worker.conversions = worker.conversions.saturating_add(1);

        // The kernel's figure where we can read one, the worker's where we cannot, and the larger of
        // the two where we have both — a worker that under-reports must not be able to dodge the
        // ceiling.
        let kernel_resident = worker
            .process_identifier()
            .and_then(resident_kibibytes)
            .unwrap_or(0);
        let resident = kernel_resident.max(reported_resident_kibibytes);

        let over_conversion_budget =
            worker.conversions >= self.configuration.max_conversions_per_worker;
        let over_memory_budget = resident > self.configuration.max_resident_kibibytes;

        if over_conversion_budget || over_memory_budget {
            self.recycle_in_background(worker);
            return;
        }

        self.push_idle(worker).await;
    }

    async fn push_idle(&self, worker: Worker) {
        self.idle.lock().await.push_back(worker);
        self.available.notify_one();
    }

    /// An unscheduled retirement: the worker crashed, wedged, or desynchronised. The pool runs one
    /// short until the reconciler or the replacement task refills it.
    async fn discard(self: &Arc<Self>, worker: Worker) {
        self.retire(worker).await;
        self.top_up();
    }

    /// A scheduled retirement. The replacement is warmed **first**, so a recycle never appears as
    /// request latency — the only paths that can leave the pool briefly short are the unscheduled
    /// ones.
    fn recycle_in_background(self: &Arc<Self>, retiring: Worker) {
        let pool = Arc::clone(self);
        tokio::spawn(async move {
            match pool.spawn_warm_worker().await {
                Ok(replacement) => {
                    // Counted before the outgoing worker is retired: for the length of the warm-up
                    // the pool deliberately holds one extra process, which is the memory headroom
                    // the instance is sized for.
                    pool.population.fetch_add(1, Ordering::SeqCst);
                    pool.push_idle(replacement).await;
                }
                Err(_) => {
                    // The replacement did not come up. Retire the over-quota worker anyway — it is
                    // over quota — and let the reconciler refill.
                }
            }
            pool.retire(retiring).await;
            pool.top_up();
        });
    }

    /// Kill and reap a worker, remove its profile directory, and drop it from the population.
    async fn retire(&self, mut worker: Worker) {
        // SIGKILL rather than a shutdown frame: this is the path a wedged child takes, and a child
        // that is not wedged loses nothing by it — its job is already finished and its profile
        // directory is about to be deleted.
        let _ = worker.child.kill().await;
        let _ = std::fs::remove_dir_all(&worker.profile_directory);
        self.warm.fetch_sub(1, Ordering::SeqCst);
        self.population.fetch_sub(1, Ordering::SeqCst);
    }

    /// Claim every free slot in the population and start filling it.
    fn top_up(self: &Arc<Self>) {
        loop {
            let claimed =
                self.population
                    .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |current| {
                        (current < self.configuration.pool_size).then_some(current + 1)
                    });
            if claimed.is_err() {
                return;
            }
            let pool = Arc::clone(self);
            tokio::spawn(async move {
                match pool.spawn_warm_worker().await {
                    Ok(worker) => pool.push_idle(worker).await,
                    Err(_) => {
                        // Release the slot so the reconciler retries rather than the pool silently
                        // running permanently short.
                        pool.population.fetch_sub(1, Ordering::SeqCst);
                    }
                }
            });
        }
    }

    /// Spawn a worker and wait for it to report that suite initialisation is complete.
    async fn spawn_warm_worker(&self) -> Result<Worker, PoolError> {
        let number = self.next_worker_number.fetch_add(1, Ordering::SeqCst);
        let profile_directory = self.prepare_profile(number).map_err(|error| {
            PoolError::WorkerFault(format!("profile preparation failed: {error}"))
        })?;

        let mut command = Command::new(&self.configuration.worker_binary);
        command
            .args(&self.configuration.worker_arguments)
            // The binding's bootstrap offers no user-profile argument, so the profile is selected
            // the way LibreOffice itself resolves it: from the process's home directory. One home
            // per worker is one `UserInstallation` per worker.
            .env("HOME", &profile_directory)
            // Headless: the suite must never look for a display server.
            .env("SAL_USE_VCLPLUGIN", "svp")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // Inherited so a suite that fails to initialise says why in the container's logs. The
            // worker itself never writes document content to either stream.
            .stderr(Stdio::inherit())
            // A supervisor that dies must not leave orphaned suite processes holding the instance's
            // memory.
            .kill_on_drop(true);

        let mut child = command
            .spawn()
            .map_err(|error| PoolError::WorkerFault(format!("worker spawn failed: {error}")))?;
        let standard_input = child
            .stdin
            .take()
            .ok_or_else(|| PoolError::WorkerFault("worker stdin was not piped".to_owned()))?;
        let standard_output = child
            .stdout
            .take()
            .ok_or_else(|| PoolError::WorkerFault("worker stdout was not piped".to_owned()))?;

        let mut worker = Worker {
            child,
            standard_input,
            standard_output: BufReader::new(standard_output),
            conversions: 0,
            profile_directory,
        };

        let readiness = timeout(
            self.configuration.warm_deadline,
            read_frame::<_, WorkerFrame>(&mut worker.standard_output),
        )
        .await;

        match readiness {
            Ok(Ok(WorkerFrame::Ready { suite_version })) => {
                {
                    let mut recorded = self.suite_version.lock().await;
                    if recorded.is_none() {
                        *recorded = Some(suite_version);
                    }
                }
                self.warm.fetch_add(1, Ordering::SeqCst);
                Ok(worker)
            }
            Ok(Ok(other)) => {
                self.kill_unwarmed(worker).await;
                Err(PoolError::WorkerFault(format!(
                    "worker answered its start-up with {other:?}"
                )))
            }
            Ok(Err(fault)) => {
                let detail = fault.to_string();
                self.kill_unwarmed(worker).await;
                Err(PoolError::WorkerFault(detail))
            }
            Err(_elapsed) => {
                self.kill_unwarmed(worker).await;
                Err(PoolError::WorkerFault(
                    "worker did not initialise inside the warm deadline".to_owned(),
                ))
            }
        }
    }

    /// Tear down a worker that never reported ready. Distinct from `retire` because it was never
    /// counted as warm, so decrementing that counter here would underflow it.
    async fn kill_unwarmed(&self, mut worker: Worker) {
        let _ = worker.child.kill().await;
        let _ = std::fs::remove_dir_all(&worker.profile_directory);
    }

    fn prepare_profile(&self, worker_number: u64) -> std::io::Result<PathBuf> {
        let directory = self
            .configuration
            .profile_root
            .join(format!("worker-{worker_number}"));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory)?;
        if let Some(template) = &self.configuration.profile_template {
            if template.exists() {
                copy_tree(template, &directory)?;
            }
        }
        Ok(directory)
    }

    /// How many workers currently exist or are being spawned. Tests read it; nothing on the request
    /// path does.
    pub fn population(&self) -> usize {
        self.population.load(Ordering::SeqCst)
    }

    /// How many workers have completed suite initialisation.
    pub fn warm_count(&self) -> usize {
        self.warm.load(Ordering::SeqCst)
    }

    /// The worker numbers handed out so far. A replacement always takes a fresh number, so this
    /// rising past `pool_size` is the observable evidence that a recycle happened.
    pub fn workers_started(&self) -> u64 {
        self.next_worker_number.load(Ordering::SeqCst)
    }
}

/// Copy a directory tree. The baked profile is a handful of small configuration files, so this is a
/// plain recursive copy rather than a dependency.
fn copy_tree(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(destination)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_copied_profile_tree_reaches_every_level() {
        let root = std::env::temp_dir().join(format!(
            "magna-carta-libreoffice-profile-copy-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let source = root.join("template");
        let nested = source.join(".config/libreoffice/4/user");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("registrymodifications.xcu"), b"<oor:items/>").unwrap();

        let destination = root.join("worker-0");
        copy_tree(&source, &destination).unwrap();

        assert_eq!(
            std::fs::read(destination.join(".config/libreoffice/4/user/registrymodifications.xcu"))
                .unwrap(),
            b"<oor:items/>"
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
