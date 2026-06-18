use magna_carta_scan::app;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    // axum 0.8: the serve future resolves to io::Result<()> on a fatal accept error; propagate it.
    axum::serve(listener, app()).await?;
    Ok(())
}
