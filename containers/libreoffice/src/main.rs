//! The supervisor: the container's HTTP host plus the worker pool.
//!
//! This process holds no LibreOfficeKit state. Everything that touches the suite is a child
//! process, so a wedged or segfaulting conversion kills its own child and this one keeps serving.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use magna_carta_libreoffice::package::sweep_spool;
use magna_carta_libreoffice::pool::{Pool, PoolConfiguration};
use magna_carta_libreoffice::service::{router, ServiceConfiguration};

/// Two workers on a single-processor instance: one can use the processor while another is blocked
/// on disk or is being replaced, and more than two would contend for one core while multiplying the
/// memory floor. Because the suite is single-threaded per instance, the real concurrency lever for
/// this engine is the number of container instances, not the depth of this pool.
const DEFAULT_POOL_SIZE: usize = 2;

/// A warm worker sits a few hundred mebibytes resident and can reach roughly a gibibyte on a large
/// document. The ceiling is per-worker rather than per-container on purpose: without it, the
/// alternative outcome is the platform out-of-memory-killing the whole instance and taking every
/// in-flight conversion with it.
const DEFAULT_MAX_RESIDENT_KIBIBYTES: u64 = 1_536 * 1024;

/// Segfaults are reported to accumulate across conversions on newer suite builds. A bounded
/// lifetime is the cheap answer to a leak we do not control.
const DEFAULT_MAX_CONVERSIONS_PER_WORKER: u32 = 50;

/// A five-hundred-page document-to-PDF conversion completes in seconds, so this means wedged, not
/// slow.
const DEFAULT_CONVERSION_DEADLINE_SECONDS: u64 = 120;

/// How long a request waits for an idle worker before the container reports itself busy.
const DEFAULT_ACQUIRE_DEADLINE_SECONDS: u64 = 30;

/// Suite initialisation takes tens of seconds; this is generously above it so a slow-but-working
/// boot is not mistaken for a broken one.
const DEFAULT_WARM_DEADLINE_SECONDS: u64 = 120;

fn environment_path(name: &str, fallback: &str) -> PathBuf {
    std::env::var_os(name)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(fallback))
}

fn environment_number<T: std::str::FromStr>(name: &str, fallback: T) -> T {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(fallback)
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let spool_directory = environment_path(
        "MAGNA_CARTA_LIBREOFFICE_SPOOL",
        "/var/spool/magna-carta-libreoffice",
    );
    let profile_root = environment_path(
        "MAGNA_CARTA_LIBREOFFICE_PROFILE_ROOT",
        "/var/lib/magna-carta/profiles",
    );
    let worker_binary = environment_path(
        "MAGNA_CARTA_LIBREOFFICE_WORKER",
        "/usr/local/bin/libreoffice-worker",
    );
    let profile_template = std::env::var_os("MAGNA_CARTA_LIBREOFFICE_PROFILE_TEMPLATE")
        .map(PathBuf::from)
        .filter(|path| path.exists());

    // A supervisor killed mid-job leaves a package behind; nothing else can, because the package's
    // drop guard runs on every other path.
    sweep_spool(&spool_directory)?;
    std::fs::create_dir_all(&profile_root)?;

    let pool = Pool::start(PoolConfiguration {
        worker_binary,
        worker_arguments: Vec::new(),
        pool_size: environment_number("MAGNA_CARTA_LIBREOFFICE_POOL_SIZE", DEFAULT_POOL_SIZE),
        profile_root,
        profile_template,
        max_conversions_per_worker: environment_number(
            "MAGNA_CARTA_LIBREOFFICE_MAX_CONVERSIONS",
            DEFAULT_MAX_CONVERSIONS_PER_WORKER,
        ),
        max_resident_kibibytes: environment_number(
            "MAGNA_CARTA_LIBREOFFICE_MAX_RESIDENT_KIBIBYTES",
            DEFAULT_MAX_RESIDENT_KIBIBYTES,
        ),
        conversion_deadline: Duration::from_secs(environment_number(
            "MAGNA_CARTA_LIBREOFFICE_CONVERSION_DEADLINE_SECONDS",
            DEFAULT_CONVERSION_DEADLINE_SECONDS,
        )),
        // Configurable for the same reason the thresholds above are: every one of these numbers is a
        // defensible starting point rather than a measurement, and they are re-derived against the
        // load-profile harness once there is a real conversion mix. The acquire deadline in
        // particular interacts with the recycle policy -- when several workers cross their budget at
        // once, the next request waits out a real suite initialisation -- so it has to be tunable
        // without an image rebuild.
        acquire_deadline: Duration::from_secs(environment_number(
            "MAGNA_CARTA_LIBREOFFICE_ACQUIRE_DEADLINE_SECONDS",
            DEFAULT_ACQUIRE_DEADLINE_SECONDS,
        )),
        warm_deadline: Duration::from_secs(environment_number(
            "MAGNA_CARTA_LIBREOFFICE_WARM_DEADLINE_SECONDS",
            DEFAULT_WARM_DEADLINE_SECONDS,
        )),
        reconcile_interval: Duration::from_secs(5),
    });

    let application = engine_host::host::with_panic_net(router(ServiceConfiguration {
        pool: Arc::clone(&pool),
        spool_directory,
    }));
    engine_host::host::serve(application).await
}
