use magna_carta_recovery::{
    router,
    server::{load_best64_rules, load_wordlist, AppState},
};
use std::sync::Arc;
use tokio::net::TcpListener;

/// Default path for the NCSC-100k wordlist baked into the container image.
const DEFAULT_WORDLIST_PATH: &str = "/app/wordlists/ncsc-100k.txt";

/// Default path for the best64 hashcat rule file baked into the container image.
const DEFAULT_RULES_PATH: &str = "/app/wordlists/best64.rule";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let wordlist_path = std::env::var("RECOVERY_WORDLIST_PATH")
        .unwrap_or_else(|_| DEFAULT_WORDLIST_PATH.to_owned());
    let rules_path =
        std::env::var("RECOVERY_RULES_PATH").unwrap_or_else(|_| DEFAULT_RULES_PATH.to_owned());

    // Load once at startup and share across all requests.
    eprintln!("recovery: loading wordlist from {wordlist_path}");
    let wordlist = load_wordlist(&wordlist_path);
    eprintln!("recovery: loaded {} words", wordlist.len());

    eprintln!("recovery: loading best64 rules from {rules_path}");
    let best64_rules = load_best64_rules(&rules_path);
    eprintln!("recovery: loaded {} rules", best64_rules.len());

    let state = AppState {
        wordlist: Arc::new(wordlist),
        best64_rules: Arc::new(best64_rules),
    };

    let listener = TcpListener::bind("0.0.0.0:8080").await?;
    eprintln!("recovery: listening on :8080");
    axum::serve(listener, router(state)).await?;
    Ok(())
}
