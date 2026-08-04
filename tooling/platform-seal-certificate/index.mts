// Provisions the platform seal identity — the signing key and self-signed certificate the sign
// worker applies the PAdES seal with. Run once per environment:
//
//   pnpm run platform-seal-certificate -- --out ./platform-seal
//
// It writes three files (the key at mode 0600), prints the certificate fingerprint to publish, and
// prints the two `wrangler secret put` commands that load the identity into the sign worker. Until
// those secrets are set, the sign worker answers 503 and POST /api/v1/documents/seal returns 503 —
// so this is the step that activates sealing.
//
// The private key is never printed. It goes to a file so it can be piped into `wrangler secret put`
// without passing through a shell argument, a scrollback buffer, or a chat transcript. Delete the
// directory once the secrets are loaded — the sign worker is the only place the key should live.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { argv, exit, stdout } from "node:process";

import { generatePlatformSealIdentity } from "../../packages/signing/src/platform-certificate.ts";

interface Arguments {
  out: string;
  commonName: string;
  organizationName: string | undefined;
  countryName: string | undefined;
  years: number;
  modulusLength: number;
}

function parseArguments(): Arguments {
  const values = new Map<string, string>();
  for (let index = 2; index < argv.length; index++) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) continue;
    const equals = token.indexOf("=");
    if (equals === -1) {
      values.set(token.slice(2), argv[++index] ?? "");
    } else {
      values.set(token.slice(2, equals), token.slice(equals + 1));
    }
  }
  const years = Number(values.get("years") ?? "10");
  const modulusLength = Number(values.get("modulus") ?? "3072");
  if (!Number.isInteger(years) || years < 1) {
    throw new RangeError("--years must be a whole number of years, at least 1.");
  }
  if (![2048, 3072, 4096].includes(modulusLength)) {
    throw new RangeError("--modulus must be 2048, 3072, or 4096.");
  }
  return {
    out: values.get("out") ?? "./platform-seal",
    commonName: values.get("common-name") ?? "Magna Carta Platform Seal",
    organizationName: values.get("organization") ?? "Magna Carta",
    countryName: values.get("country"),
    years,
    modulusLength,
  };
}

const options = parseArguments();

// The validity window starts now and runs for --years. A platform seal is deliberately long-lived:
// the certificate outliving the documents it sealed is what keeps them verifiable without a
// timestamp authority in the picture.
const notBefore = new Date();
const notAfter = new Date(notBefore);
notAfter.setUTCFullYear(notAfter.getUTCFullYear() + options.years);

const identity = await generatePlatformSealIdentity({
  commonName: options.commonName,
  ...(options.organizationName !== undefined ? { organizationName: options.organizationName } : {}),
  ...(options.countryName !== undefined ? { countryName: options.countryName } : {}),
  notBefore,
  notAfter,
  modulusLength: options.modulusLength,
});

const directory = resolve(options.out);
await mkdir(directory, { recursive: true, mode: 0o700 });

const keyPath = resolve(directory, "PLATFORM_SEAL_KEY.base64");
const certPath = resolve(directory, "PLATFORM_SEAL_CERT.base64");
const pemPath = resolve(directory, "platform-seal-certificate.pem");

// 0600 on the key: readable only by the operator who generated it. The certificate is public.
await writeFile(keyPath, identity.privateKeyPkcs8Base64, { encoding: "utf8", mode: 0o600 });
await writeFile(certPath, identity.certificateDerBase64, { encoding: "utf8", mode: 0o600 });
await writeFile(pemPath, identity.certificatePem, { encoding: "utf8", mode: 0o644 });

stdout.write(`Platform seal identity generated.

  Subject      ${options.commonName}
  Serial       ${identity.serialNumberHex}
  Valid        ${identity.notBefore} -> ${identity.notAfter}
  Key size     RSA ${options.modulusLength}
  Fingerprint  ${identity.certificateFingerprintSha256}   (SHA-256 over the certificate)

Files written to ${directory}
  PLATFORM_SEAL_KEY.base64            the PKCS#8 private key   (mode 0600 — secret)
  PLATFORM_SEAL_CERT.base64           the DER certificate
  platform-seal-certificate.pem       the certificate, for validators and counsel

Load the identity into the sign worker (pipe the file, so the value never reaches your shell history):

  wrangler secret put PLATFORM_SEAL_KEY  --name magna-carta-sign < ${keyPath}
  wrangler secret put PLATFORM_SEAL_CERT --name magna-carta-sign < ${certPath}

Then delete ${directory} — the sign worker is the only place this key should live. Publish the
fingerprint above alongside the certificate: the seal is self-signed by design, so a validator trusts
it only once the certificate is distributed as a trust anchor.
`);

exit(0);
