use clamav_client::tokio::{scan_buffer, Tcp};

/// The clamd verdict for a buffer. `Unavailable` covers a socket/daemon error or a non-UTF-8 reply —
/// the verdict layer maps it to `unscanned` (never a silent `clean`).
pub enum ClamVerdict {
    Clean,
    Infected(String),
    Unavailable,
}

/// The clamd endpoint inside the container image. clamd listens on loopback TCP only — no network
/// egress (the Container runs with `enableInternet = false`), and a co-located TCP socket keeps this
/// client cross-platform: clamav-client's Unix-domain-socket transport compiles only on Unix, so the
/// service talks to the daemon over `127.0.0.1` instead.
pub const DEFAULT_CLAMD_ADDRESS: &str = "127.0.0.1:3310";

/// Streams a buffer to clamd over loopback TCP and interprets the INSTREAM reply.
pub async fn clamav_scan(bytes: &[u8], clamd_address: &str) -> ClamVerdict {
    let connection = Tcp {
        host_address: clamd_address,
    };
    // chunk_size None -> the crate's default INSTREAM chunk size.
    let response = match scan_buffer(bytes, connection, None).await {
        Ok(response) => response,
        Err(_) => return ClamVerdict::Unavailable,
    };
    // clean() yields only a bool (and can fail on a non-UTF-8 reply); the signature name, when a hit,
    // is parsed out of the raw reply since clean() does not surface it.
    match clamav_client::clean(&response) {
        Ok(true) => ClamVerdict::Clean,
        Ok(false) => ClamVerdict::Infected(parse_signature(&response)),
        Err(_) => ClamVerdict::Unavailable,
    }
}

// clamd's INSTREAM hit reply is "stream: <Signature-Name> FOUND\0"; extract the signature name.
fn parse_signature(response: &[u8]) -> String {
    let text = String::from_utf8_lossy(response);
    let text = text.trim_end_matches('\0').trim();
    text.strip_prefix("stream: ")
        .and_then(|rest| rest.strip_suffix(" FOUND"))
        .unwrap_or(text)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::parse_signature;

    #[test]
    fn parses_the_signature_name_from_a_found_reply() {
        assert_eq!(
            parse_signature(b"stream: Eicar-Test-Signature FOUND\0"),
            "Eicar-Test-Signature"
        );
    }

    #[test]
    fn falls_back_to_the_trimmed_reply_when_unparseable() {
        assert_eq!(parse_signature(b"stream: OK\0"), "stream: OK");
    }
}
