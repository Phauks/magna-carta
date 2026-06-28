use axum::{
    extract::Path,
    routing::{get, put},
    Router,
};
use magna_carta_bundle::r2::{get_to_writer, put_file};
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;

// A minimal in-memory R2 stub: GET returns stored bytes, PUT stores the body. Stands in for the owner
// Worker's outbound-Workers R2 mediation.
#[tokio::test]
async fn get_then_put_roundtrips_through_the_base_url() {
    let store: Arc<Mutex<std::collections::HashMap<String, Vec<u8>>>> = Arc::new(Mutex::new(
        std::collections::HashMap::from([("inputs/a".to_string(), b"hello world".to_vec())]),
    ));
    let s1 = store.clone();
    let app = Router::new()
        .route(
            "/{*key}",
            get(move |Path(key): Path<String>| {
                let s = s1.clone();
                async move {
                    s.lock()
                        .unwrap()
                        .get(&key)
                        .cloned()
                        .map(axum::body::Bytes::from)
                        .ok_or(axum::http::StatusCode::NOT_FOUND)
                }
            }),
        )
        .route(
            "/{*key}",
            put({
                let s2 = store.clone();
                move |Path(key): Path<String>, body: axum::body::Bytes| {
                    let s = s2.clone();
                    async move {
                        s.lock().unwrap().insert(key, body.to_vec());
                        axum::http::StatusCode::OK
                    }
                }
            }),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    let http = reqwest::Client::new();
    let mut buf: Vec<u8> = Vec::new();
    let n = get_to_writer(&http, &base, "inputs/a", &mut buf)
        .await
        .unwrap();
    assert_eq!(n, 11);
    assert_eq!(buf, b"hello world");

    // round-trip a PUT: write bytes to a temp file, PUT it, GET it back
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("out");
    std::fs::write(&path, b"archive-bytes").unwrap();
    let file = tokio::fs::File::open(&path).await.unwrap();
    put_file(&http, &base, "outputs/out.zip", file, 13)
        .await
        .unwrap();
    let mut got: Vec<u8> = Vec::new();
    get_to_writer(&http, &base, "outputs/out.zip", &mut got)
        .await
        .unwrap();
    assert_eq!(got, b"archive-bytes");
}
