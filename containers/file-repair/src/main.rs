//! Thin container entrypoint: wrap the engine's work routes in the standard
//! `/ready` probe, body cap, and panic net, then serve on the container's
//! :8080 contract. All logic lives in the library.

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let app = engine_host::host::with_panic_net(engine_host::host::ready_app(
        magna_carta_file_repair::router(),
    ));
    engine_host::host::serve(app).await
}
