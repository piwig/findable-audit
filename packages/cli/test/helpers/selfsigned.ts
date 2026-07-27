// A throwaway self-signed certificate, built at test time.
//
// The transport probe (#22) can only be exercised end-to-end against a real TLS server,
// and a real TLS server needs a key pair and a certificate. Neither is something this
// repo may add: a PEM private key committed to a public repository is a bad look whatever
// its purpose, and a certificate generator is a runtime dependency this project does not
// take. So the certificate is assembled here, in DER, from `node:crypto` alone — valid
// for one hour, for `localhost` and 127.0.0.1, and never written to disk.
//
// If the environment cannot produce it (no RSA, no signing), `makeSelfSigned()` returns
// null and the caller skips its TLS test rather than failing it.

import crypto from 'node:crypto';

/** DER tag-length-value. */
function der(tag: number, payload: Buffer): Buffer {
  let length: Buffer;
  if (payload.length < 0x80) {
    length = Buffer.from([payload.length]);
  } else {
    const bytes: number[] = [];
    let n = payload.length;
    while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
    length = Buffer.from([0x80 | bytes.length, ...bytes]);
  }
  return Buffer.concat([Buffer.from([tag]), length, payload]);
}

const seq = (...parts: Buffer[]): Buffer => der(0x30, Buffer.concat(parts));
const set = (...parts: Buffer[]): Buffer => der(0x31, Buffer.concat(parts));

function integer(value: Buffer): Buffer {
  // DER integers are signed: a leading bit of 1 needs a zero byte in front.
  const body = value[0] & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value;
  return der(0x02, body);
}

/** Encode a dotted OID ("2.5.29.17") as DER contents. */
function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  const bytes: number[] = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const chunk: number[] = [part & 0x7f];
    let rest = part >> 7;
    while (rest > 0) { chunk.unshift((rest & 0x7f) | 0x80); rest >>= 7; }
    bytes.push(...chunk);
  }
  return der(0x06, Buffer.from(bytes));
}

const utf8 = (s: string): Buffer => der(0x0c, Buffer.from(s, 'utf8'));
const bitString = (payload: Buffer): Buffer => der(0x03, Buffer.concat([Buffer.from([0]), payload]));
const octetString = (payload: Buffer): Buffer => der(0x04, payload);
const boolTrue = (): Buffer => der(0x01, Buffer.from([0xff]));

/** YYMMDDHHMMSSZ, the UTCTime form X.509 uses before 2050. */
function utcTime(date: Date): Buffer {
  const p = (n: number): string => String(n).padStart(2, '0');
  const text =
    p(date.getUTCFullYear() % 100) + p(date.getUTCMonth() + 1) + p(date.getUTCDate()) +
    p(date.getUTCHours()) + p(date.getUTCMinutes()) + p(date.getUTCSeconds()) + 'Z';
  return der(0x17, Buffer.from(text, 'ascii'));
}

/** CN=<name>, the only relative distinguished name this certificate needs. */
function name(commonName: string): Buffer {
  return seq(set(seq(oid('2.5.4.3'), utf8(commonName))));
}

const SHA256_WITH_RSA = (): Buffer => seq(oid('1.2.840.113549.1.1.11'), der(0x05, Buffer.alloc(0)));

function pem(label: string, body: Buffer): string {
  const base64 = body.toString('base64').replace(/(.{64})/g, '$1\n');
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`;
}

export interface SelfSigned { key: string; cert: string; host: string; }

/**
 * A fresh RSA-2048 key and a matching self-signed certificate for `localhost`
 * (SAN: DNS localhost + IP 127.0.0.1), usable as both the server identity and the
 * client's trust anchor. Returns null when the environment cannot build one.
 */
export function makeSelfSigned(): SelfSigned | null {
  try {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;

    const now = new Date();
    const notBefore = new Date(now.getTime() - 60_000);
    const notAfter = new Date(now.getTime() + 3_600_000);

    const subjectAltName = seq(
      der(0x82, Buffer.from('localhost', 'ascii')), // [2] dNSName
      der(0x87, Buffer.from([127, 0, 0, 1])), // [7] iPAddress
    );
    const extensions = der(0xa3, seq(
      seq(oid('2.5.29.17'), octetString(subjectAltName)),
      // CA:TRUE so the certificate can also be its own trust anchor on the client side.
      seq(oid('2.5.29.19'), boolTrue(), octetString(seq(boolTrue()))),
    ));

    const tbs = seq(
      der(0xa0, integer(Buffer.from([2]))), // [0] version v3
      integer(crypto.randomBytes(8)),
      SHA256_WITH_RSA(),
      name('localhost'),
      seq(utcTime(notBefore), utcTime(notAfter)),
      name('localhost'),
      spki,
      extensions,
    );

    const signature = crypto.createSign('sha256').update(tbs).sign(privateKey);
    const cert = seq(tbs, SHA256_WITH_RSA(), bitString(signature));

    return {
      key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
      cert: pem('CERTIFICATE', cert),
      host: 'localhost',
    };
  } catch {
    return null;
  }
}
