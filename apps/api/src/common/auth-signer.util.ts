import * as crypto from 'node:crypto';
import type { AuthConfig } from '@api-open/shared';

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}

export async function buildJwtHeader(
  auth: Extract<AuthConfig, { type: 'jwt' }>,
): Promise<string> {
  let parsedPayload: Record<string, unknown> = {};
  if (auth.payload?.trim()) {
    parsedPayload = JSON.parse(auth.payload) as Record<string, unknown>;
  }
  const alg = auth.algorithm === 'HS512' ? 'HS512' : 'HS256';
  const headerB64 = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({ ...parsedPayload, iat: Math.floor(Date.now() / 1000) }),
  ).toString('base64url');
  const sig = crypto
    .createHmac(alg === 'HS512' ? 'sha512' : 'sha256', auth.secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  const prefix = auth.headerPrefix?.trim() || 'Bearer';
  return `${prefix} ${headerB64}.${payloadB64}.${sig}`;
}

export function buildHawkHeader(
  auth: Extract<AuthConfig, { type: 'hawk' }>,
  method: string,
  url: URL,
): string {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(4).toString('hex');
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const resource = `${url.pathname}${url.search}`;

  const normalized = [
    'hawk.1.header',
    ts,
    nonce,
    method.toUpperCase(),
    resource,
    url.hostname,
    port,
    '',
    '',
    '',
  ].join('\n');

  const mac = crypto
    .createHmac(auth.algorithm || 'sha256', auth.hawkKey)
    .update(normalized)
    .digest('base64');

  return `Hawk id="${auth.hawkId}", ts="${ts}", nonce="${nonce}", mac="${mac}"`;
}

export function applyAwsSigV4Headers(
  auth: Extract<AuthConfig, { type: 'aws' }>,
  method: string,
  url: URL,
  headers: Headers,
  bodyPayload: string | Buffer | undefined,
) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = auth.region || 'us-east-1';
  const service = auth.service || 'execute-api';

  headers.set('host', url.host);
  headers.set('x-amz-date', amzDate);
  if (auth.sessionToken) {
    headers.set('x-amz-security-token', auth.sessionToken);
  }

  const payloadHash = sha256Hex(bodyPayload ?? '');
  headers.set('x-amz-content-sha256', payloadHash);

  const sortedQuery = Array.from(url.searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const signedHeaderKeys = Array.from(headers.keys())
    .map((k) => k.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderKeys
    .map((k) => `${k}:${(headers.get(k) ?? '').trim()}\n`)
    .join('');
  const signedHeaders = signedHeaderKeys.join(';');

  const canonicalRequest = [
    method.toUpperCase(),
    url.pathname || '/',
    sortedQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmacSha256(`AWS4${auth.secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = crypto
    .createHmac('sha256', kSigning)
    .update(stringToSign)
    .digest('hex');

  headers.set(
    'authorization',
    `AWS4-HMAC-SHA256 Credential=${auth.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  );
}

export function buildDigestHeader(
  wwwAuthenticate: string,
  username: string,
  password: string,
  method: string,
  uri: string,
): string | null {
  if (!wwwAuthenticate.toLowerCase().startsWith('digest ')) return null;
  const params: Record<string, string> = {};
  const regex = /(\w+)=(?:"([^"]+)"|([^,\s]+))/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(wwwAuthenticate)) !== null) {
    params[m[1]] = m[2] ?? m[3] ?? '';
  }

  const realm = params.realm ?? '';
  const nonce = params.nonce ?? '';
  const qop = params.qop?.split(',')[0]?.trim();
  const opaque = params.opaque;
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');

  const md5 = (v: string) => crypto.createHash('md5').update(v).digest('hex');
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method.toUpperCase()}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (opaque) parts.push(`opaque="${opaque}"`);
  return `Digest ${parts.join(', ')}`;
}

function rfc3986Encode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function buildOAuth1Header(
  auth: Extract<AuthConfig, { type: 'oauth1' }>,
  method: string,
  url: URL,
): string {
  const sigMethod = auth.signatureMethod || 'HMAC-SHA1';
  const nonce = crypto.randomBytes(12).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: auth.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: sigMethod,
    oauth_timestamp: timestamp,
    oauth_version: '1.0',
  };
  if (auth.token) oauthParams.oauth_token = auth.token;

  const signingKey = `${rfc3986Encode(auth.consumerSecret)}&${rfc3986Encode(auth.tokenSecret ?? '')}`;
  let signature = '';

  if (sigMethod === 'PLAINTEXT') {
    signature = signingKey;
  } else {
    const allParams: Array<[string, string]> = [];
    for (const [k, v] of url.searchParams.entries()) {
      allParams.push([k, v]);
    }
    for (const [k, v] of Object.entries(oauthParams)) {
      allParams.push([k, v]);
    }
    allParams.sort((a, b) =>
      a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]),
    );
    const paramStr = allParams
      .map(([k, v]) => `${rfc3986Encode(k)}=${rfc3986Encode(v)}`)
      .join('&');
    const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
    const baseString = `${method.toUpperCase()}&${rfc3986Encode(baseUrl)}&${rfc3986Encode(paramStr)}`;
    const algo = sigMethod === 'HMAC-SHA256' ? 'sha256' : 'sha1';
    signature = crypto
      .createHmac(algo, signingKey)
      .update(baseString)
      .digest('base64');
  }

  const headerParts: string[] = [];
  if (auth.realm) headerParts.push(`realm="${rfc3986Encode(auth.realm)}"`);
  for (const [k, v] of Object.entries({ ...oauthParams, oauth_signature: signature })) {
    headerParts.push(`${rfc3986Encode(k)}="${rfc3986Encode(v)}"`);
  }
  return `OAuth ${headerParts.join(', ')}`;
}

/** Pure-JS MD4 for NTLMv2 (OpenSSL 3 disables MD4 by default). */
function md4(buf: Buffer): Buffer {
  const len = buf.length;
  const bitLen = len * 8;
  const padLen = ((56 - ((len + 1) % 64)) + 64) % 64;
  const msg = Buffer.alloc(len + 1 + padLen + 8);
  buf.copy(msg, 0);
  msg[len] = 0x80;
  msg.writeUInt32LE(bitLen >>> 0, msg.length - 8);
  msg.writeUInt32LE(Math.floor(bitLen / 0x100000000), msg.length - 4);

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;
  const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;
  const F = (x: number, y: number, z: number) => (x & y) | (~x & z);
  const G = (x: number, y: number, z: number) => (x & y) | (x & z) | (y & z);
  const H = (x: number, y: number, z: number) => x ^ y ^ z;

  for (let i = 0; i < msg.length; i += 64) {
    const X: number[] = [];
    for (let j = 0; j < 16; j++) X.push(msg.readUInt32LE(i + j * 4));
    const [aa, bb, cc, dd] = [a, b, c, d];
    const r1 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const s1 = [3, 7, 11, 19];
    for (let k = 0; k < 16; k++) {
      const idx = r1[k];
      const sh = s1[k % 4];
      const t = rotl((a + F(b, c, d) + X[idx]) >>> 0, sh);
      a = d; d = c; c = b; b = t;
    }
    const r2 = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15];
    const s2 = [3, 5, 9, 13];
    for (let k = 0; k < 16; k++) {
      const idx = r2[k];
      const sh = s2[k % 4];
      const t = rotl((a + G(b, c, d) + X[idx] + 0x5a827999) >>> 0, sh);
      a = d; d = c; c = b; b = t;
    }
    const r3 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
    const s3 = [3, 9, 11, 15];
    for (let k = 0; k < 16; k++) {
      const idx = r3[k];
      const sh = s3[k % 4];
      const t = rotl((a + H(b, c, d) + X[idx] + 0x6ed9eba1) >>> 0, sh);
      a = d; d = c; c = b; b = t;
    }
    a = (a + aa) >>> 0;
    b = (b + bb) >>> 0;
    c = (c + cc) >>> 0;
    d = (d + dd) >>> 0;
  }
  const out = Buffer.alloc(16);
  out.writeUInt32LE(a, 0);
  out.writeUInt32LE(b, 4);
  out.writeUInt32LE(c, 8);
  out.writeUInt32LE(d, 12);
  return out;
}

export function buildNtlmType1Header(domain = '', workstation = ''): string {
  const domBuf = Buffer.from(domain.toUpperCase(), 'ascii');
  const wsBuf = Buffer.from(workstation.toUpperCase(), 'ascii');
  const buf = Buffer.alloc(32 + domBuf.length + wsBuf.length);
  buf.write('NTLMSSP\0', 0, 'ascii');
  buf.writeUInt32LE(1, 8); // Type 1
  buf.writeUInt32LE(0x00088207, 12); // Negotiate flags
  buf.writeUInt16LE(domBuf.length, 16);
  buf.writeUInt16LE(domBuf.length, 18);
  buf.writeUInt32LE(32 + wsBuf.length, 20);
  buf.writeUInt16LE(wsBuf.length, 24);
  buf.writeUInt16LE(wsBuf.length, 26);
  buf.writeUInt32LE(32, 28);
  wsBuf.copy(buf, 32);
  domBuf.copy(buf, 32 + wsBuf.length);
  return `NTLM ${buf.toString('base64')}`;
}

export function buildNtlmType3Header(
  wwwAuthenticate: string,
  username: string,
  password: string,
  domain = '',
  workstation = '',
): string | null {
  const match = /NTLM\s+([A-Za-z0-9+/=]+)/i.exec(wwwAuthenticate);
  if (!match) return null;
  const type2 = Buffer.from(match[1], 'base64');
  if (type2.length < 32 || type2.toString('ascii', 0, 8) !== 'NTLMSSP\0') return null;

  const serverChallenge = type2.subarray(24, 32);
  const ntlmHash = md4(Buffer.from(password, 'utf16le'));
  const userDom = Buffer.from(`${username.toUpperCase()}${domain.toUpperCase()}`, 'utf16le');
  const ntlmV2Hash = crypto.createHmac('md5', ntlmHash).update(userDom).digest();

  const clientChallenge = crypto.randomBytes(8);
  const targetInfoLen = type2.length >= 48 ? type2.readUInt16LE(40) : 0;
  const targetInfoOffset = type2.length >= 48 ? type2.readUInt32LE(44) : 0;
  const targetInfo =
    targetInfoLen > 0 && targetInfoOffset + targetInfoLen <= type2.length
      ? type2.subarray(targetInfoOffset, targetInfoOffset + targetInfoLen)
      : Buffer.alloc(0);

  const nowFileTime = BigInt(Date.now() + 11644473600000) * 10000n;
  const blob = Buffer.alloc(28 + targetInfo.length + 4);
  blob.writeUInt32LE(0x00000101, 0);
  blob.writeBigUInt64LE(nowFileTime, 8);
  clientChallenge.copy(blob, 16);
  targetInfo.copy(blob, 28);

  const ntProofStr = crypto
    .createHmac('md5', ntlmV2Hash)
    .update(Buffer.concat([serverChallenge, blob]))
    .digest();
  const ntResponse = Buffer.concat([ntProofStr, blob]);
  const lmResponse = Buffer.concat([
    crypto
      .createHmac('md5', ntlmV2Hash)
      .update(Buffer.concat([serverChallenge, clientChallenge]))
      .digest(),
    clientChallenge,
  ]);

  const domBuf = Buffer.from(domain.toUpperCase(), 'utf16le');
  const userBuf = Buffer.from(username, 'utf16le');
  const wsBuf = Buffer.from(workstation.toUpperCase(), 'utf16le');

  let offset = 64;
  const lmOff = offset; offset += lmResponse.length;
  const ntOff = offset; offset += ntResponse.length;
  const domOff = offset; offset += domBuf.length;
  const userOff = offset; offset += userBuf.length;
  const wsOff = offset; offset += wsBuf.length;

  const msg = Buffer.alloc(offset);
  msg.write('NTLMSSP\0', 0, 'ascii');
  msg.writeUInt32LE(3, 8);
  msg.writeUInt16LE(lmResponse.length, 12);
  msg.writeUInt16LE(lmResponse.length, 14);
  msg.writeUInt32LE(lmOff, 16);
  msg.writeUInt16LE(ntResponse.length, 20);
  msg.writeUInt16LE(ntResponse.length, 22);
  msg.writeUInt32LE(ntOff, 24);
  msg.writeUInt16LE(domBuf.length, 28);
  msg.writeUInt16LE(domBuf.length, 30);
  msg.writeUInt32LE(domOff, 32);
  msg.writeUInt16LE(userBuf.length, 36);
  msg.writeUInt16LE(userBuf.length, 38);
  msg.writeUInt32LE(userOff, 40);
  msg.writeUInt16LE(wsBuf.length, 44);
  msg.writeUInt16LE(wsBuf.length, 46);
  msg.writeUInt32LE(wsOff, 48);
  msg.writeUInt32LE(0x00088207, 60);

  lmResponse.copy(msg, lmOff);
  ntResponse.copy(msg, ntOff);
  domBuf.copy(msg, domOff);
  userBuf.copy(msg, userOff);
  wsBuf.copy(msg, wsOff);

  return `NTLM ${msg.toString('base64')}`;
}
