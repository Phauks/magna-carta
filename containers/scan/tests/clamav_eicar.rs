use magna_carta_scan::clamav::{scan_buffer, ClamVerdict};
use magna_carta_scan::raw::{clam_fact, ClamFact};

// The real clamd detection check, over the INSTREAM transport (it scans a buffer with only a clamd
// address — no shared scratch directory needed, so it runs anywhere a daemon listens; the production
// path SCAN is exercised end-to-end by the container scan harness). It needs a running clamd, so it is
// #[ignore]d in a normal `cargo test` run and exercised only where a daemon is available (the Docker
// EICAR gate, or `CLAMD_ADDRESS=127.0.0.1:3310 cargo test -- --ignored`). The standard EICAR test string
// must come back as an infection whose signature names EICAR — never Clean, never Unavailable — and that
// infection must lower to the raw `clam: { state: "infected", signature: … }` fact the container returns
// (the app, not the container, decides what an infected fact means for the firm).
#[tokio::test]
#[ignore = "requires a running clamd; set CLAMD_ADDRESS and run with --ignored"]
async fn detects_eicar() {
    let address =
        std::env::var("CLAMD_ADDRESS").expect("set CLAMD_ADDRESS to a running clamd TCP endpoint");
    let eicar = br"X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

    let verdict = scan_buffer(eicar, &address).await;
    let signature = match &verdict {
        ClamVerdict::Infected(signature) => {
            assert!(
                signature.to_uppercase().contains("EICAR"),
                "expected an EICAR signature, got {signature:?}"
            );
            signature.clone()
        }
        ClamVerdict::Clean => panic!("EICAR was reported clean"),
        ClamVerdict::Unavailable => panic!("clamd was unavailable at {address}"),
    };

    // The infection lowers to the raw fact the /scan response carries — a named signature, not a verdict.
    assert_eq!(
        clam_fact(&verdict),
        ClamFact::Infected {
            signature: signature.clone()
        }
    );
    assert_eq!(
        serde_json::to_value(clam_fact(&verdict)).unwrap(),
        serde_json::json!({ "state": "infected", "signature": signature })
    );
}
