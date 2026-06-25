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
    // The YARA corpus is baked into the image by `build-yara-rules` (filtered, compiled, serialized) and
    // restored here at boot — no startup recompile of the full corpus. When no blob is configured (the
    // dev/test build), the service runs on clamd + the structural heuristics alone. The Forge release tag
    // baked alongside the blob becomes the engine-version `yara-rules` component. Shared across requests
    // by Arc.
    let (rules, yara_tag) = load_yara_rules_at_startup();

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

    eprintln!(
        "scan engine: {} YARA rules loaded (Forge tag {})",
        yara::rulesets_version(&rules),
        yara_tag,
    );
    let engine_version =
        compose_engine_version(yara::ENGINE_CODE_VERSION, &yara_tag, &clamav_db_version);

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

/// Loads the baked YARA rule blob at startup, returning the rules and the YARA Forge release tag for the
/// engine-version string. `YARA_RULES_PATH` points at the serialized blob `build-yara-rules` produced;
/// `YARA_RULES_TAG` is the Forge release it was built from. When the path is unset (the dev/test build),
/// the service runs rule-free on clamd + the structural heuristics and the tag reads `none`.
///
/// A configured-but-unreadable or corrupt blob is FATAL: the service must never silently fall back to an
/// empty corpus, which would drop the entire YARA layer while the rest of the system believes rules are
/// active — exactly the kind of silent degradation the never-silently-clean invariant forbids.
fn load_yara_rules_at_startup() -> (yara_x::Rules, String) {
    let Ok(path) = std::env::var("YARA_RULES_PATH") else {
        return (yara::build_rules(&[]), "none".to_string());
    };
    let bytes = std::fs::read(&path).unwrap_or_else(|error| {
        eprintln!(
            "FATAL: cannot read the baked YARA rule blob at {path}: {error}. Refusing to start — \
             falling back to an empty corpus would silently drop the YARA detection layer. Fix: ensure \
             the image build ran build-yara-rules and baked the blob at that path."
        );
        std::process::exit(1);
    });
    let rules = yara::deserialize_rules(&bytes).unwrap_or_else(|error| {
        eprintln!(
            "FATAL: cannot deserialize the baked YARA rule blob at {path}: {error}. A corrupt or \
             version-mismatched blob must fail loud, never degrade to a rule-free scan. Fix: rebuild \
             the image so build-yara-rules re-serializes with this yara-x version."
        );
        std::process::exit(1);
    });
    // A configured blob must carry rules AND a real tag. Enforce both at the load path so the invariant
    // "rules loaded ⇒ a real yara-rules version" holds independently of the build gates: an empty rule
    // set, or a missing/`unknown` tag while rules ARE loaded, is a broken build — fail loud rather than
    // serve a labeled-but-rule-less scan, or serve with `unknown` (which would alias distinct rule sets
    // in the staleness gate, freezing re-scans). `unknown`/`none` are only valid in the rule-free dev
    // build (the unset-path branch above).
    if yara::rulesets_version(&rules) == 0 {
        eprintln!(
            "FATAL: the baked YARA rule blob at {path} deserialized to ZERO rules. Refusing to serve a \
             scan that reports a rules tag but runs no rules. The build-yara-rules gates should prevent \
             this — rebuild the image."
        );
        std::process::exit(1);
    }
    let tag = std::env::var("YARA_RULES_TAG")
        .ok()
        .filter(|tag| !tag.is_empty() && tag != "unknown")
        .unwrap_or_else(|| {
            eprintln!(
                "FATAL: a YARA rule blob is loaded ({path}) but YARA_RULES_TAG is missing or `unknown`. \
                 The tag is the engine-version `yara-rules` component (the re-scan staleness key); \
                 serving `unknown` would mislabel which rules ran. Fix: ensure the build wrote the tag \
                 beside the blob (entrypoint.sh exports it from /etc/scan/yara-rules.tag)."
            );
            std::process::exit(1);
        });
    (rules, tag)
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
    let mut last_error = std::io::Error::other("no attempts were made (max_attempts was zero)");
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
