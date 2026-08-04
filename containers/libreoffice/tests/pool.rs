//! The supervisor's state machine, proved against the fake worker binary.
//!
//! None of this needs LibreOffice, and all of it is the part most likely to be wrong: acquire and
//! release, the acquire deadline, the conversion deadline killing exactly one child, replacement
//! after a crash, both recycle triggers, the pre-warmed replacement never showing as latency, and
//! the pool continuing to serve throughout every one of those.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use magna_carta_libreoffice::dispatch::recipe_for;
use magna_carta_libreoffice::package::JobPackage;
use magna_carta_libreoffice::pool::{Pool, PoolConfiguration, PoolError};
use magna_carta_libreoffice::protocol::UnconvertibleCode;

const FAKE_WORKER: &str = env!("CARGO_BIN_EXE_magna-carta-libreoffice-fake-worker");

static NEXT_FIXTURE: AtomicU32 = AtomicU32::new(0);

/// A throwaway spool + profile root for one test, removed when the test's guard drops.
struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let number = NEXT_FIXTURE.fetch_add(1, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!(
            "magna-carta-libreoffice-pool-{label}-{}-{number}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("spool")).unwrap();
        std::fs::create_dir_all(root.join("profiles")).unwrap();
        Self { root }
    }

    fn spool(&self) -> PathBuf {
        self.root.join("spool")
    }

    fn profiles(&self) -> PathBuf {
        self.root.join("profiles")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn configuration(fixture: &Fixture, worker_arguments: &[&str]) -> PoolConfiguration {
    PoolConfiguration {
        worker_binary: PathBuf::from(FAKE_WORKER),
        worker_arguments: worker_arguments.iter().map(|a| (*a).to_owned()).collect(),
        pool_size: 1,
        profile_root: fixture.profiles(),
        profile_template: None,
        max_conversions_per_worker: 1_000,
        max_resident_kibibytes: u64::MAX,
        conversion_deadline: Duration::from_millis(500),
        acquire_deadline: Duration::from_millis(500),
        warm_deadline: Duration::from_secs(5),
        reconcile_interval: Duration::from_millis(50),
    }
}

fn package(fixture: &Fixture) -> JobPackage {
    let recipe = recipe_for("docx", "pdf", "pdf").unwrap();
    JobPackage::create(&fixture.spool(), b"fixture source bytes", &recipe).unwrap()
}

async fn convert_once(pool: &Arc<Pool>, fixture: &Fixture) -> Result<Vec<u8>, PoolError> {
    let job = package(fixture);
    pool.convert(&job).await?;
    Ok(job.read_output().unwrap().expect("output document"))
}

#[tokio::test]
async fn a_warm_pool_serves_a_conversion_and_returns_the_worker_to_service() {
    let fixture = Fixture::new("serve");
    let pool = Pool::start(configuration(&fixture, &[]));
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    for _ in 0..3 {
        let bytes = convert_once(&pool, &fixture).await.unwrap();
        assert!(bytes.starts_with(b"%PDF-"));
    }
    // Three conversions on one worker: released and re-acquired, never replaced.
    assert_eq!(pool.workers_started(), 1);
}

#[tokio::test]
async fn the_pool_is_not_ready_until_a_worker_reports_suite_initialisation() {
    let fixture = Fixture::new("ready");
    let pool = Pool::start(configuration(&fixture, &["--ready-delay-ms", "400"]));

    assert!(
        !pool.is_ready(),
        "the pool must not claim readiness before a worker has initialised"
    );
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);
    assert_eq!(
        pool.suite_version().await.as_deref(),
        Some("LibreOffice 25.8 (fake)")
    );
}

#[tokio::test]
async fn a_worker_that_never_initialises_never_counts_as_ready() {
    let fixture = Fixture::new("never-ready");
    let mut settings = configuration(&fixture, &["--never-ready"]);
    settings.warm_deadline = Duration::from_millis(300);
    let pool = Pool::start(settings);

    assert!(!pool.wait_until_ready(Duration::from_millis(700)).await);
    assert_eq!(pool.warm_count(), 0);
}

#[tokio::test]
async fn the_acquire_deadline_reports_the_pool_busy_rather_than_waiting_forever() {
    let fixture = Fixture::new("acquire");
    // One worker that takes far longer per job than the acquire deadline allows.
    let mut settings = configuration(&fixture, &["--job-delay-ms", "3000"]);
    settings.conversion_deadline = Duration::from_secs(10);
    settings.acquire_deadline = Duration::from_millis(200);
    let pool = Pool::start(settings);
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    let occupier = Arc::clone(&pool);
    let occupier_spool = fixture.spool();
    let held = tokio::spawn(async move {
        let recipe = recipe_for("docx", "pdf", "pdf").unwrap();
        let job = JobPackage::create(&occupier_spool, b"x", &recipe).unwrap();
        occupier.convert(&job).await
    });
    // Let the occupier take the only worker.
    tokio::time::sleep(Duration::from_millis(150)).await;

    let job = package(&fixture);
    let started = std::time::Instant::now();
    let outcome = pool.convert(&job).await;
    assert!(matches!(outcome, Err(PoolError::NoWorkerAvailable)));
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "the acquire deadline must bound the wait"
    );

    let _ = held.await;
}

#[tokio::test]
async fn a_released_worker_wakes_a_waiting_request_immediately() {
    let fixture = Fixture::new("wake");
    let mut settings = configuration(&fixture, &["--job-delay-ms", "250"]);
    settings.conversion_deadline = Duration::from_secs(10);
    settings.acquire_deadline = Duration::from_secs(5);
    let pool = Pool::start(settings);
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    let first = Arc::clone(&pool);
    let first_spool = fixture.spool();
    let occupier = tokio::spawn(async move {
        let recipe = recipe_for("docx", "pdf", "pdf").unwrap();
        let job = JobPackage::create(&first_spool, b"x", &recipe).unwrap();
        first.convert(&job).await
    });
    tokio::time::sleep(Duration::from_millis(80)).await;

    // The waiter must be woken by the release, not by polling out its whole acquire deadline.
    let started = std::time::Instant::now();
    convert_once(&pool, &fixture).await.unwrap();
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "a released worker must wake a waiting request"
    );
    occupier.await.unwrap().unwrap();
}

#[tokio::test]
async fn the_conversion_deadline_kills_the_wedged_child_and_the_next_request_succeeds() {
    let fixture = Fixture::new("wedge");
    // Each worker converts its first job and wedges on its second. So the first request succeeds,
    // the second wedges and costs that worker its life, and the third lands on the replacement —
    // which is the sequence the acceptance suite asserts against the real suite.
    let mut settings = configuration(
        &fixture,
        &["--behaviour", "hang", "--behaviour-from-job", "2"],
    );
    settings.conversion_deadline = Duration::from_millis(300);
    settings.acquire_deadline = Duration::from_secs(5);
    let pool = Pool::start(settings);
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    assert!(convert_once(&pool, &fixture)
        .await
        .unwrap()
        .starts_with(b"%PDF-"));

    let job = package(&fixture);
    let outcome = pool.convert(&job).await;
    assert!(
        matches!(outcome, Err(PoolError::ConversionDeadline)),
        "a wedged conversion must report the deadline, not a fault or a success"
    );
    drop(job);

    // The very next request is served, by the replacement.
    let recovered = tokio::time::timeout(Duration::from_secs(10), convert_once(&pool, &fixture))
        .await
        .expect("the pool must keep serving after a wedge")
        .expect("the replacement must convert");
    assert!(recovered.starts_with(b"%PDF-"));
    assert!(
        pool.workers_started() >= 2,
        "the wedged worker must have been replaced, not reused"
    );
}

#[tokio::test]
async fn a_worker_that_exits_non_zero_is_a_retryable_fault_and_is_replaced() {
    let fixture = Fixture::new("exit");
    let pool = Pool::start(configuration(
        &fixture,
        &["--behaviour", "exit:3", "--behaviour-from-job", "1"],
    ));
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    let job = package(&fixture);
    let outcome = pool.convert(&job).await;
    assert!(
        matches!(outcome, Err(PoolError::WorkerFault(_))),
        "a dead worker is a retryable fault, never a 200 and never a document verdict"
    );
    drop(job);

    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);
    assert!(pool.workers_started() >= 2);
}

#[tokio::test]
async fn a_worker_that_dies_on_a_signal_is_handled_exactly_like_one_that_exits() {
    let fixture = Fixture::new("abort");
    let pool = Pool::start(configuration(
        &fixture,
        &["--behaviour", "abort", "--behaviour-from-job", "1"],
    ));
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    let job = package(&fixture);
    assert!(matches!(
        pool.convert(&job).await,
        Err(PoolError::WorkerFault(_))
    ));
    drop(job);

    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);
    assert!(pool.workers_started() >= 2);
}

#[tokio::test]
async fn a_malformed_answer_is_a_fault_rather_than_a_hang_or_a_silent_success() {
    let fixture = Fixture::new("garbage");
    let pool = Pool::start(configuration(
        &fixture,
        &["--behaviour", "garbage", "--behaviour-from-job", "1"],
    ));
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    let job = package(&fixture);
    let started = std::time::Instant::now();
    assert!(matches!(
        pool.convert(&job).await,
        Err(PoolError::WorkerFault(_))
    ));
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "a desynchronised pipe must fail promptly, not wait out the conversion deadline"
    );
}

#[tokio::test]
async fn an_unconvertible_document_is_a_document_verdict_and_the_worker_keeps_serving() {
    let fixture = Fixture::new("unconvertible");
    let pool = Pool::start(configuration(
        &fixture,
        &[
            "--behaviour",
            "unconvertible:password-protected",
            "--behaviour-from-job",
            "1",
        ],
    ));
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    let job = package(&fixture);
    assert!(matches!(
        pool.convert(&job).await,
        Err(PoolError::Unconvertible(
            UnconvertibleCode::PasswordProtected
        ))
    ));
    drop(job);

    // The worker was healthy — only the document was not — so it must not have been replaced.
    let second = package(&fixture);
    assert!(matches!(
        pool.convert(&second).await,
        Err(PoolError::Unconvertible(_))
    ));
    assert_eq!(
        pool.workers_started(),
        1,
        "an unconvertible document must not cost a worker"
    );
}

#[tokio::test]
async fn the_conversion_count_ceiling_recycles_a_worker() {
    let fixture = Fixture::new("count-recycle");
    let mut settings = configuration(&fixture, &[]);
    settings.max_conversions_per_worker = 2;
    let pool = Pool::start(settings);
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    convert_once(&pool, &fixture).await.unwrap();
    assert_eq!(pool.workers_started(), 1, "still inside the budget");

    convert_once(&pool, &fixture).await.unwrap();

    // The second conversion reaches the ceiling, so a replacement is warmed and the over-quota
    // worker retired.
    let replaced = tokio::time::timeout(Duration::from_secs(5), async {
        while pool.workers_started() < 2 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await;
    assert!(
        replaced.is_ok(),
        "reaching the ceiling must replace the worker"
    );

    // And the pool keeps serving across the replacement.
    let bytes = convert_once(&pool, &fixture).await.unwrap();
    assert!(bytes.starts_with(b"%PDF-"));
}

#[tokio::test]
async fn the_resident_memory_ceiling_recycles_a_worker() {
    let fixture = Fixture::new("memory-recycle");
    // The worker reports a resident set well past the ceiling. The supervisor takes the larger of
    // the kernel's figure and the worker's, so a self-reported runaway is enough to trigger this
    // on any host — including one with no /proc to read.
    let mut settings = configuration(&fixture, &["--resident-kibibytes", "4194304"]);
    settings.max_resident_kibibytes = 1024;
    let pool = Pool::start(settings);
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    convert_once(&pool, &fixture).await.unwrap();

    let replaced = tokio::time::timeout(Duration::from_secs(5), async {
        while pool.workers_started() < 2 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await;
    assert!(
        replaced.is_ok(),
        "a worker past the resident-set ceiling must be replaced"
    );

    let bytes = convert_once(&pool, &fixture).await.unwrap();
    assert!(bytes.starts_with(b"%PDF-"));
}

#[tokio::test]
async fn a_scheduled_recycle_does_not_appear_as_request_latency() {
    let fixture = Fixture::new("prewarm");
    // One worker, retired after a single conversion, and a replacement that costs 500 ms to warm.
    // The conversion that trips the ceiling must return long before that: the replacement is
    // started alongside the outgoing worker rather than in front of the request that triggered it.
    let mut settings = configuration(&fixture, &["--ready-delay-ms", "500"]);
    settings.pool_size = 1;
    settings.max_conversions_per_worker = 1;
    settings.acquire_deadline = Duration::from_secs(10);
    let pool = Pool::start(settings);
    assert!(pool.wait_until_ready(Duration::from_secs(10)).await);

    let started = std::time::Instant::now();
    let bytes = convert_once(&pool, &fixture).await.unwrap();
    assert!(bytes.starts_with(b"%PDF-"));
    assert!(
        started.elapsed() < Duration::from_millis(400),
        "a scheduled recycle must be warmed off the request path, not charged to the request that \
         triggered it (took {:?})",
        started.elapsed()
    );

    // The replacement does arrive, and the pool goes on serving across the swap.
    tokio::time::timeout(Duration::from_secs(10), async {
        while pool.workers_started() < 2 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the over-quota worker must be replaced");
    assert!(convert_once(&pool, &fixture)
        .await
        .unwrap()
        .starts_with(b"%PDF-"));
}

#[tokio::test]
async fn two_simultaneous_conversions_are_both_served_and_both_correct() {
    let fixture = Fixture::new("concurrency");
    // Each job takes 300 ms. With two workers the pair completes in roughly one job's time; with a
    // single serialised worker it could not. This is the assertion that proves the pool is doing
    // its job — naive concurrent suite invocations against one profile fail silently.
    let mut settings = configuration(&fixture, &["--job-delay-ms", "300"]);
    settings.pool_size = 2;
    settings.conversion_deadline = Duration::from_secs(10);
    settings.acquire_deadline = Duration::from_secs(5);
    let pool = Pool::start(settings);
    tokio::time::timeout(Duration::from_secs(10), async {
        while pool.warm_count() < 2 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("both workers must warm");

    let started = std::time::Instant::now();
    let first = tokio::spawn({
        let pool = Arc::clone(&pool);
        let spool = fixture.spool();
        async move {
            let recipe = recipe_for("docx", "pdf", "pdf").unwrap();
            let job = JobPackage::create(&spool, b"first", &recipe).unwrap();
            pool.convert(&job).await.unwrap();
            job.read_output().unwrap().unwrap()
        }
    });
    let second = tokio::spawn({
        let pool = Arc::clone(&pool);
        let spool = fixture.spool();
        async move {
            let recipe = recipe_for("odt", "pdf", "pdf").unwrap();
            let job = JobPackage::create(&spool, b"second", &recipe).unwrap();
            pool.convert(&job).await.unwrap();
            job.read_output().unwrap().unwrap()
        }
    });

    let first = first.await.unwrap();
    let second = second.await.unwrap();
    assert!(first.starts_with(b"%PDF-"));
    assert!(second.starts_with(b"%PDF-"));
    assert!(
        started.elapsed() < Duration::from_millis(550),
        "two conversions must run in parallel across the pool, not serialise (took {:?})",
        started.elapsed()
    );
}

#[tokio::test]
async fn the_pool_holds_its_population_and_never_over_spawns() {
    let fixture = Fixture::new("population");
    let mut settings = configuration(&fixture, &[]);
    settings.pool_size = 2;
    let pool = Pool::start(settings);
    tokio::time::timeout(Duration::from_secs(10), async {
        while pool.warm_count() < 2 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("both workers must warm");

    // The reconciler runs every 50 ms; give it plenty of turns and prove it does not stack workers.
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(pool.population(), 2);
    assert_eq!(pool.warm_count(), 2);
    assert_eq!(pool.workers_started(), 2);
}

#[tokio::test]
async fn a_worker_that_cannot_be_spawned_leaves_the_pool_refilling_rather_than_wedged() {
    let fixture = Fixture::new("unspawnable");
    let mut settings = configuration(&fixture, &[]);
    settings.worker_binary = fixture.spool().join("no-such-worker-binary");
    settings.acquire_deadline = Duration::from_millis(200);
    let pool = Pool::start(settings);

    // Nothing ever becomes ready, and a request is refused promptly rather than hanging.
    assert!(!pool.wait_until_ready(Duration::from_millis(500)).await);
    let job = package(&fixture);
    assert!(matches!(
        pool.convert(&job).await,
        Err(PoolError::NoWorkerAvailable)
    ));
    // The slot was released back, so the reconciler is still trying rather than the pool having
    // permanently lost its population.
    assert!(pool.population() <= 1);
}

#[tokio::test]
async fn a_worker_reporting_no_output_never_becomes_an_empty_success() {
    let fixture = Fixture::new("empty-output");
    let pool = Pool::start(configuration(
        &fixture,
        &["--behaviour", "empty-output", "--behaviour-from-job", "1"],
    ));
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    let job = package(&fixture);
    // The pool itself reports success — it only knows what the worker told it — and the read-back
    // is what catches the absent output. The HTTP surface turns this into a 500, never a 200 with
    // an empty body.
    pool.convert(&job).await.unwrap();
    assert_eq!(job.read_output().unwrap(), None);
}

#[tokio::test]
async fn every_job_directory_is_removed_on_the_deadline_path() {
    let fixture = Fixture::new("cleanup");
    let mut settings = configuration(
        &fixture,
        &["--behaviour", "hang", "--behaviour-from-job", "1"],
    );
    settings.conversion_deadline = Duration::from_millis(200);
    let pool = Pool::start(settings);
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    {
        let job = package(&fixture);
        assert!(std::fs::read_dir(job.directory()).is_ok());
        let _ = pool.convert(&job).await;
    }
    // Only the spool root survives; the job directory went with the package.
    let remaining = std::fs::read_dir(fixture.spool()).unwrap().count();
    assert_eq!(
        remaining, 0,
        "a wedged job must not leave its package behind"
    );
}
