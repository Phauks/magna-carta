use magna_carta_search::router;
use tokio::net::TcpListener;

// The keyword-search engine's binary: bind :8080 and serve the four operations. Nothing is loaded at
// startup — the engine's state is the splits in the firm's object store, reached per request, so a cold
// instance is ready as soon as it is listening.
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let listener = TcpListener::bind("0.0.0.0:8080").await?;
    eprintln!("search: listening on :8080");
    axum::serve(listener, router()).await?;
    Ok(())
}
