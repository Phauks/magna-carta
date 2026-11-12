use tokio::net::TcpListener;

#[tokio::main]
async fn main() {
    let listener = TcpListener::bind("0.0.0.0:8080")
        .await
        .expect("failed to bind :8080");
    axum::serve(listener, magna_carta_transcode::router())
        .await
        .expect("server error");
}
