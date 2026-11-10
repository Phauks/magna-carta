//! Bit-level reading for the parameter-set fields the engine inspects, and the RBSP unescaping
//! (emulation-prevention removal) that has to happen before them.

use crate::error::{Result, TranscodeError};

/// Remove emulation-prevention bytes (`00 00 03` becomes `00 00`) from a NAL unit payload.
pub fn unescape_rbsp(nal: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(nal.len());
    let mut zeros = 0usize;
    for &byte in nal {
        if zeros >= 2 && byte == 3 {
            zeros = 0;
            continue;
        }
        zeros = if byte == 0 { zeros + 1 } else { 0 };
        out.push(byte);
    }
    out
}

/// A most-significant-bit-first reader with Exp-Golomb support. Running off the end is an error, not
/// a panic: the bytes come from an untrusted file.
pub struct BitReader<'a> {
    data: &'a [u8],
    position: usize,
}

impl<'a> BitReader<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Self { data, position: 0 }
    }

    pub fn bit(&mut self) -> Result<u32> {
        let byte = self
            .data
            .get(self.position / 8)
            .ok_or_else(|| TranscodeError::malformed("a parameter set ends early"))?;
        let bit = (byte >> (7 - (self.position % 8))) & 1;
        self.position += 1;
        Ok(u32::from(bit))
    }

    pub fn bits(&mut self, count: u32) -> Result<u32> {
        let mut value = 0u32;
        for _ in 0..count {
            value = (value << 1) | self.bit()?;
        }
        Ok(value)
    }

    pub fn flag(&mut self) -> Result<bool> {
        Ok(self.bit()? == 1)
    }

    /// `ue(v)`. Values wider than 31 bits are rejected; no field the engine reads is that wide.
    pub fn unsigned_exp_golomb(&mut self) -> Result<u32> {
        let mut leading_zeros = 0u32;
        while self.bit()? == 0 {
            leading_zeros += 1;
            if leading_zeros > 31 {
                return Err(TranscodeError::malformed("an Exp-Golomb code is too long"));
            }
        }
        let suffix = self.bits(leading_zeros)?;
        Ok(((1u64 << leading_zeros) - 1 + u64::from(suffix)).min(u64::from(u32::MAX)) as u32)
    }

    /// `se(v)`.
    pub fn signed_exp_golomb(&mut self) -> Result<i32> {
        let code = self.unsigned_exp_golomb()?;
        let magnitude = code.div_ceil(2) as i32;
        Ok(if code % 2 == 1 { magnitude } else { -magnitude })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unescape_removes_emulation_prevention() {
        assert_eq!(
            unescape_rbsp(&[0, 0, 3, 1, 0, 0, 3, 0]),
            vec![0, 0, 1, 0, 0, 0]
        );
    }

    #[test]
    fn exp_golomb_reads_known_codes() {
        // 1 | 010 | 011 | 00100 => 0, 1, 2, 3
        let mut reader = BitReader::new(&[0b1010_0110, 0b0100_0000]);
        assert_eq!(reader.unsigned_exp_golomb().unwrap(), 0);
        assert_eq!(reader.unsigned_exp_golomb().unwrap(), 1);
        assert_eq!(reader.unsigned_exp_golomb().unwrap(), 2);
        assert_eq!(reader.unsigned_exp_golomb().unwrap(), 3);
    }

    #[test]
    fn running_off_the_end_is_an_error() {
        let mut reader = BitReader::new(&[0]);
        assert!(reader.unsigned_exp_golomb().is_err());
    }
}
