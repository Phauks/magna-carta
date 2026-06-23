use magna_carta_scan::{
    clamav, compose_engine_version, heuristics::ArchiveCaps, router, yara, AppState,
};
use std::sync::Arc;
use tokio::net::TcpListener;

/// How long to wait between clamd version-query attempts at startup.
const STARTUP_RETRY_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);

/// Maximum startup attempts to query the clamd DB version before giving up. Clamd can take a few
/// seconds to finish loading its signature database after the socket becomes connectable, so a short
/// retry window (≤ 30 s total with a 2 s interval) is correct and bounded. If clamd is genuinely
/// unreachable after all attempts the service must exit loudly — never serve with a fabricated DB
/// version that would silently freeze the re-scan staleness gate.
const STARTUP_MAX_ATTEMPTS: u32 = 15;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // The YARA corpus is baked into the image; rule-directory loading lands with the image build, so
    // the service starts with no yara rules today (clamd + the structural heuristics still scan). Rules
    // compile once at startup and are shared across requests by Arc.
    let rules = yara::build_rules(&[]);

    // Read the clamd signature-database version once at startup. clamd is baked into the same image
    // with `enableInternet = false`, so the DB is fixed for this instance's lifetime — a single read
    // is correct. We must have it before serving: the composite engine version drives re-scan
    // staleness, and a missing DB token would silently freeze that gate (never-silently-clean).
    let clamav_db_version = query_clamav_db_version_at_startup(
        clamav::DEFAULT_CLAMD_ADDRESS,
        STARTUP_MAX_ATTEMPTS,
        STARTUP_RETRY_INTERVAL,
    )
    .await
    .unwrap_or_else(|error| {
        eprintln!(
            "FATAL: could not read the clamd signature-database version after {} attempts: {}. \
             Refusing to start — a missing DB version would silently freeze the re-scan staleness \
             gate. Fix: ensure clamd is running and reachable on {}.",
            STARTUP_MAX_ATTEMPTS,
            error,
            clamav::DEFAULT_CLAMD_ADDRESS,
        );
        std::process::exit(1);
    });

    let engine_version = compose_engine_version(
        yara::ENGINE_CODE_VERSION,
        yara::rulesets_version(&rules),
        &clamav_db_version,
    );

    let state = AppState {
        rules: Arc::new(rules),
        clamd_address: clamav::DEFAULT_CLAMD_ADDRESS.into(),
        caps: ArchiveCaps::default(),
        engine_version: engine_version.into(),
    };

    let listener = TcpListener::bind("0.0.0.0:8080").await?;
    // axum 0.8: the serve future resolves to io::Result<()> on a fatal accept error; propagate it.
    axum::serve(listener, router(state)).await?;
    Ok(())
}

/// Queries the clamd DB version with a bounded retry loop. Retries on connect or parse failure
/// (clamd can take a moment to finish loading its signature database after the socket opens).
/// Returns an error if all attempts are exhausted — the caller must treat that as a fatal startup
/// failure.
async fn query_clamav_db_version_at_startup(
    clamd_address: &str,
    max_attempts: u32,
    retry_interval: std::time::Duration,
) -> Result<String, std::io::Error> {
    let mut last_error =
        std::io::Error::other("no attempts were made (max_attempts was zero)");
    for attempt in 1..=max_attempts {
        match clamav::query_clamav_db_version(clamd_address).await {
            Ok(version) => return Ok(version),
            Err(error) => {
                last_error = error;
                if attempt < max_attempts {
                    tokio::time::sleep(retry_interval).await;
                }
            }
        }
    }
    Err(last_error)
}
