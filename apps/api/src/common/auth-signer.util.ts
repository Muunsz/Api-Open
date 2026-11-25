import * as crypto from 'node:crypto';
import type { AuthConfig } from '@api-open/shared';
import { SignJWT } from 'jose';

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
  const secretKey = new TextEncoder().encode(auth.secret);
  const jwt = await new SignJWT(parsedPayload)
    .setProtectedHeader({ alg: auth.algorithm || 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .sign(secretKey);

  const prefix = auth.headerPrefix?.trim() || 'Bearer';
  return `${prefix} ${jwt}`;
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
