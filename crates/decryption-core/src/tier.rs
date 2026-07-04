//! Recovery-tier classifier — determines whether a given hashcat mode can be
//! handled within Cloudflare CPU budget (CfCapable) or requires offline GPU
//! hardware (GpuRequired).
//!
//! Classification is by `hashcat_mode` (the authoritative signal); `format` is
//! available for tiebreaks but is not the primary discriminator.
//!
//! Any mode not in the explicit allowlist defaults to `GpuRequired`. This is a
//! safety property: never burn unbounded Cloudflare CPU on a format whose
//! computational hardness is unknown.

use crate::Format;

/// Whether a recovery job can run on Cloudflare CPU or needs offline GPU hardware.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryTier {
    /// Fast or medium KDF — a meaningful dictionary pass completes within
    /// Cloudflare CPU budget (legacy RC4 derivatives, ZipCrypto, WinZip-AES).
    CfCapable,
    /// Slow KDF — requires offline GPU hardware (PDF R5/R6, OOXML agile, 7-Zip).
    GpuRequired,
}

/// Classify a hashcat mode into the appropriate recovery tier.
///
/// `format` is accepted for future tiebreak use; mode is the primary signal.
/// Unknown modes always resolve to `GpuRequired` — the safe default.
pub fn recovery_tier(_format: Format, hashcat_mode: u32) -> RecoveryTier {
    match hashcat_mode {
        // Legacy PDF RC4 (revisions 2–4) — fast MD5/RC4 chain.
        10400 | 10500 => RecoveryTier::CfCapable,

        // ZipCrypto — the 17200-series our extractor emits (PKZIP classic stream cipher).
        17200 | 17210 | 17220 | 17225 | 17230 => RecoveryTier::CfCapable,

        // Old Office RC4 (Office 97-2003) — fast MD5/RC4 chain.
        9700 | 9710 | 9720 | 9800 | 9810 | 9820 => RecoveryTier::CfCapable,

        // WinZip-AES — AES with low-iteration PBKDF2; medium cost, fits CF budget.
        13600 => RecoveryTier::CfCapable,

        // PDF R5/R6 — SHA-256 + AES-256 KDF; GPU-class workload.
        10600 | 10700 => RecoveryTier::GpuRequired,

        // OOXML agile encryption — high-iteration PBKDF2 (default 100 000+ rounds).
        9400 | 9500 | 9600 => RecoveryTier::GpuRequired,

        // 7-Zip — AES-256 with SHA-256 KDF; GPU-class workload.
        11600 => RecoveryTier::GpuRequired,

        // Unknown mode: default to GpuRequired — safety property, never burns
        // unbounded CF compute on formats with unverified computational hardness.
        _ => RecoveryTier::GpuRequired,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Format;

    #[test]
    fn classifies_by_mode() {
        assert_eq!(recovery_tier(Format::Pdf, 10500), RecoveryTier::CfCapable); // RC4
        assert_eq!(recovery_tier(Format::Pdf, 10700), RecoveryTier::GpuRequired); // R6
        assert_eq!(recovery_tier(Format::Zip, 13600), RecoveryTier::CfCapable); // WinZip-AES
        assert_eq!(
            recovery_tier(Format::Ooxml, 9600),
            RecoveryTier::GpuRequired
        ); // agile
    }

    #[test]
    fn unknown_mode_defaults_to_gpu_required() {
        // Unknown modes must never resolve CfCapable — safety property.
        assert_eq!(recovery_tier(Format::Pdf, 99999), RecoveryTier::GpuRequired);
        assert_eq!(recovery_tier(Format::Zip, 0), RecoveryTier::GpuRequired);
        assert_eq!(
            recovery_tier(Format::Ooxml, 12345),
            RecoveryTier::GpuRequired
        );
    }

    #[test]
    fn zipcrypto_series_are_cf_capable() {
        for mode in [17200_u32, 17210, 17220, 17225, 17230] {
            assert_eq!(recovery_tier(Format::Zip, mode), RecoveryTier::CfCapable);
        }
    }

    #[test]
    fn old_office_rc4_is_cf_capable() {
        for mode in [9700_u32, 9710, 9720, 9800, 9810, 9820] {
            assert_eq!(recovery_tier(Format::Ooxml, mode), RecoveryTier::CfCapable);
        }
    }

    #[test]
    fn pdf_r5_r6_are_gpu_required() {
        assert_eq!(recovery_tier(Format::Pdf, 10600), RecoveryTier::GpuRequired);
        assert_eq!(recovery_tier(Format::Pdf, 10700), RecoveryTier::GpuRequired);
    }

    #[test]
    fn seven_zip_is_gpu_required() {
        assert_eq!(recovery_tier(Format::Zip, 11600), RecoveryTier::GpuRequired);
    }
}
