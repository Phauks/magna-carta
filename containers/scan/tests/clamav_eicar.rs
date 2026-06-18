use magna_carta_scan::clamav::{clamav_scan, ClamVerdict};

// The real clamd detection check. It needs a running clamd, so it is #[ignore]d in a normal
// `cargo test` run and exercised only where a daemon is available (the Docker EICAR gate, or
// `CLAMD_ADDRESS=127.0.0.1:3310 cargo test -- --ignored`). The standard EICAR test string must come
// back as an infection whose signature names EICAR — never Clean, never Unavailable.
#[tokio::test]
#[ignore = "requires a running clamd; set CLAMD_ADDRESS and run with --ignored"]
async fn detects_eicar() {
    let address =
        std::env::var("CLAMD_ADDRESS").expect("set CLAMD_ADDRESS to a running clamd TCP endpoint");
    let eicar = br"X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

    match clamav_scan(eicar, &address).await {
        ClamVerdict::Infected(signature) => {
            assert!(
                signature.to_uppercase().contains("EICAR"),
                "expected an EICAR signature, got {signature:?}"
            );
        }
        ClamVerdict::Clean => panic!("EICAR was reported clean"),
        ClamVerdict::Unavailable => panic!("clamd was unavailable at {address}"),
    }
}
