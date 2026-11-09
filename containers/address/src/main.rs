use magna_carta_address::{router, Service, Settings};
use tokio::net::TcpListener;

// The address engine's binary: bind :8080 and serve. Nothing is loaded at startup — the index is opened
// on the first query from whatever the pointer names, so a cold instance is ready as soon as it listens,
// and a build instance never opens an index at all.
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let service = Service::new(&Settings::production());
    let listener = TcpListener::bind("0.0.0.0:8080").await?;
    eprintln!("address: listening on :8080");
    axum::serve(listener, router(service)).await?;
    Ok(())
}
