//! The few H.264 sequence-parameter-set fields that decide whether a stream can be copied into the
//! rendition untouched, and how large its pictures are before anything is decoded.

use crate::bits::{unescape_rbsp, BitReader};
use crate::error::{Result, TranscodeError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SequenceInfo {
    pub profile_idc: u32,
    pub chroma_format_idc: u32,
    pub bit_depth_luma: u32,
    pub bit_depth_chroma: u32,
    pub frame_mbs_only: bool,
    pub width_in_macroblocks: u32,
    pub height_in_macroblocks: u32,
}

impl SequenceInfo {
    /// Whether every current browser decodes this stream: 8-bit 4:2:0 progressive at Constrained
    /// Baseline, Main or High. High 10, the 4:2:2 and 4:4:4 profiles and interlaced coding are the
    /// cases a browser refuses or renders wrongly, so they are re-encoded instead.
    pub fn plays_in_every_browser(&self) -> bool {
        matches!(self.profile_idc, 66 | 77 | 100)
            && self.chroma_format_idc == 1
            && self.bit_depth_luma == 8
            && self.bit_depth_chroma == 8
            && self.frame_mbs_only
    }
}

fn skip_scaling_list(reader: &mut BitReader<'_>, size: u32) -> Result<()> {
    let mut last_scale = 8i32;
    let mut next_scale = 8i32;
    for _ in 0..size {
        if next_scale != 0 {
            let delta = reader.signed_exp_golomb()?;
            next_scale = (last_scale + delta + 256).rem_euclid(256);
        }
        if next_scale != 0 {
            last_scale = next_scale;
        }
    }
    Ok(())
}

/// Parse a sequence parameter set NAL unit (header byte included, emulation prevention present).
pub fn parse(nal: &[u8]) -> Result<SequenceInfo> {
    let rbsp = unescape_rbsp(nal);
    let header = *rbsp
        .first()
        .ok_or_else(|| TranscodeError::malformed("an empty H.264 parameter set"))?;
    if header & 0x1f != 7 {
        return Err(TranscodeError::malformed(
            "an H.264 parameter set is not a sequence parameter set",
        ));
    }
    let mut reader = BitReader::new(rbsp.get(1..).unwrap_or_default());
    let profile_idc = reader.bits(8)?;
    let _constraint_flags_and_reserved = reader.bits(8)?;
    let _level_idc = reader.bits(8)?;
    let _sequence_parameter_set_id = reader.unsigned_exp_golomb()?;
    let (mut chroma_format_idc, mut bit_depth_luma, mut bit_depth_chroma) = (1, 8, 8);
    if matches!(
        profile_idc,
        100 | 110 | 122 | 244 | 44 | 83 | 86 | 118 | 128 | 138 | 139 | 134 | 135
    ) {
        chroma_format_idc = reader.unsigned_exp_golomb()?;
        if chroma_format_idc == 3 {
            let _separate_colour_plane = reader.flag()?;
        }
        bit_depth_luma = reader.unsigned_exp_golomb()?.saturating_add(8);
        bit_depth_chroma = reader.unsigned_exp_golomb()?.saturating_add(8);
        let _qpprime_y_zero_transform_bypass = reader.flag()?;
        if reader.flag()? {
            let lists = if chroma_format_idc == 3 { 12 } else { 8 };
            for index in 0..lists {
                if reader.flag()? {
                    skip_scaling_list(&mut reader, if index < 6 { 16 } else { 64 })?;
                }
            }
        }
    }
    let _log2_max_frame_num_minus4 = reader.unsigned_exp_golomb()?;
    let picture_order_count_type = reader.unsigned_exp_golomb()?;
    if picture_order_count_type == 0 {
        let _log2_max_pic_order_cnt_lsb_minus4 = reader.unsigned_exp_golomb()?;
    } else if picture_order_count_type == 1 {
        let _delta_pic_order_always_zero = reader.flag()?;
        let _offset_for_non_ref_pic = reader.signed_exp_golomb()?;
        let _offset_for_top_to_bottom_field = reader.signed_exp_golomb()?;
        let cycle = reader.unsigned_exp_golomb()?;
        if cycle > 255 {
            return Err(TranscodeError::malformed(
                "an H.264 picture order cycle is out of range",
            ));
        }
        for _ in 0..cycle {
            let _offset_for_ref_frame = reader.signed_exp_golomb()?;
        }
    }
    let _max_num_ref_frames = reader.unsigned_exp_golomb()?;
    let _gaps_in_frame_num_allowed = reader.flag()?;
    let width_in_macroblocks = reader.unsigned_exp_golomb()?.saturating_add(1);
    let height_in_map_units = reader.unsigned_exp_golomb()?.saturating_add(1);
    let frame_mbs_only = reader.flag()?;
    let height_in_macroblocks =
        height_in_map_units.saturating_mul(if frame_mbs_only { 1 } else { 2 });
    Ok(SequenceInfo {
        profile_idc,
        chroma_format_idc,
        bit_depth_luma,
        bit_depth_chroma,
        frame_mbs_only,
        width_in_macroblocks,
        height_in_macroblocks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_high_profile_sequence() {
        // x264 High profile, 640x368 coded (640x360 cropped), progressive.
        let sps = [
            0x67, 0x64, 0x00, 0x1e, 0xac, 0xd9, 0x40, 0xa0, 0x2f, 0xf9, 0x70, 0x11, 0x00, 0x00,
            0x03, 0x00, 0x01, 0x00, 0x00, 0x03, 0x00, 0x3c, 0x0f, 0x16, 0x2d, 0x96,
        ];
        let info = parse(&sps).unwrap();
        assert_eq!(info.profile_idc, 100);
        assert_eq!(info.chroma_format_idc, 1);
        assert_eq!(info.bit_depth_luma, 8);
        assert!(info.frame_mbs_only);
        assert_eq!(info.width_in_macroblocks, 40);
        assert_eq!(info.height_in_macroblocks, 23);
        assert!(info.plays_in_every_browser());
    }

    #[test]
    fn rejects_a_truncated_sequence() {
        assert!(parse(&[0x67, 0x64]).is_err());
    }
}
