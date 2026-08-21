import * as OTPAuth from "otpauth";

// Better Auth's twoFactor plugin TOTP parameters (verified against the pinned 1.6.16 source,
// plugins/two-factor/totp): HMAC-SHA1, 6 digits, 30-second period; the otpauth:// URI carries the
// base32 encoding of the raw secret's ASCII bytes. The ONE home for these pinned parameters — a
// library bump that changes them fails every consumer here, not in scattered copies.
export function createAuthenticator(secretBase32: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secretBase32),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
}

// Parses the base32 secret out of the enable response's otpauth:// provisioning URI.
export function secretFromTotpUri(totpURI: string): string {
  const secretBase32 = /[?&]secret=([^&]+)/.exec(totpURI)?.[1];
  if (secretBase32 === undefined) throw new Error(`totpURI carries no secret: ${totpURI}`);
  return secretBase32;
}
