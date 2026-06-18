use magna_carta_scan::{clamav, heuristics::ArchiveCaps, router, yara, AppState};
use std::sync::Arc;
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // The YARA corpus is baked into the image; rule-directory loading lands with the image build, so
    // the service starts with no yara rules today (clamd + the structural heuristics still scan). Rules
    // compile once at startup and are shared across requests by Arc.
    let rules = yara::build_rules(&[]);
    let engine_version = format!("clamav+yara-x/{}+heuristics/1", yara::ENGINE_VERSION);
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
