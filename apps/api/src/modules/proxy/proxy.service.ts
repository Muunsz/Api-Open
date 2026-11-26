import { BadRequestException, Injectable } from '@nestjs/common';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';
import type { TLSSocket } from 'node:tls';
import * as grpc from '@grpc/grpc-js';
import * as protobuf from 'protobufjs';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import type {
  BodyConfig,
  ClientCertConfig,
  HttpMethod,
  ProxyExecuteRequest,
  ProxyExecuteResponse,
  ResponseTiming,
} from '@api-open/shared';
import {
  applyAwsSigV4Headers,
  buildDigestHeader,
  buildHawkHeader,
  buildJwtHeader,
  buildNtlmType1Header,
  buildNtlmType3Header,
  buildOAuth1Header,
} from '../../common/auth-signer.util';
import { validateTargetUrl } from '../../common/ssrf.util';

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 30_000;

export interface RecordedTrafficEntry {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  statusCode: number;
  durationMs: number;
  responseBody: string;
  timestamp: string;
}

@Injectable()
export class ProxyService {
  private readonly recordedSessions = new Map<string, RecordedTrafficEntry[]>();
  private readonly webhookBins = new Map<
    string,
    Array<{
      id: string;
      method: string;
      headers: Record<string, string>;
      query: Record<string, unknown>;
      body: string;
      timestamp: string;
    }>
  >();

  captureWebhookEvent(binId: string, req: Request) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined) {
        headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
      }
    }
    const rawBody =
      req.body && typeof req.body === 'object'
        ? JSON.stringify(req.body, null, 2)
        : typeof req.body === 'string'
          ? req.body
          : '';
    const entry = {
      id: Math.random().toString(36).slice(2, 10),
      method: req.method.toUpperCase(),
      headers,
      query: req.query as Record<string, unknown>,
      body: rawBody,
      timestamp: new Date().toISOString(),
    };
    const list = this.webhookBins.get(binId) ?? [];
    list.unshift(entry);
    this.webhookBins.set(binId, list.slice(0, 100));
    return { received: true, binId, eventId: entry.id };
  }

  getWebhookEvents(binId: string) {
    return this.webhookBins.get(binId) ?? [];
  }

  clearWebhookEvents(binId: string) {
    this.webhookBins.delete(binId);
    return { cleared: true };
  }

  getRecordedTraffic(sessionId: string): RecordedTrafficEntry[] {
    return this.recordedSessions.get(sessionId) ?? [];
  }

  clearRecordedTraffic(sessionId: string) {
    this.recordedSessions.delete(sessionId);
    return { cleared: true };
  }

  async recordAndForward(
    sessionId: string,
    req: Request,
  ): Promise<ProxyExecuteResponse> {
    const targetBase =
      (req.headers['x-target-base'] as string | undefined) ||
      (req.query.target as string | undefined);
    if (!targetBase) {
      throw new BadRequestException(
        'Provide target base URL via X-Target-Base header or ?target= query param',
      );
    }
    const prefix = `/proxy/record/${sessionId}`;
    const subPath = req.path.startsWith(prefix)
      ? req.path.slice(prefix.length) || '/'
      : '/';
    const targetUrl = `${targetBase.replace(/\/$/, '')}${subPath}`;

    const forwardHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const lk = k.toLowerCase();
      if (
        lk === 'host' ||
        lk === 'x-target-base' ||
        lk === 'content-length' ||
        lk === 'connection'
      ) {
        continue;
      }
      if (v !== undefined) {
        forwardHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v);
      }
    }

    const rawBody =
      req.body && typeof req.body === 'object'
        ? JSON.stringify(req.body)
        : typeof req.body === 'string'
          ? req.body
          : '';

    const result = await this.execute({
      method: req.method.toUpperCase() as HttpMethod,
      url: targetUrl,
      headers: forwardHeaders,
      body: rawBody ? { mode: 'raw', raw: rawBody, rawType: 'json' } : { mode: 'none' },
    });

    const entries = this.recordedSessions.get(sessionId) ?? [];
    entries.unshift({
      id: Math.random().toString(36).slice(2, 10),
      method: req.method.toUpperCase(),
      url: targetUrl,
      headers: forwardHeaders,
      body: rawBody,
      statusCode: result.statusCode,
      durationMs: result.durationMs,
      responseBody: result.isBase64 ? '[binary]' : result.body.slice(0, 4000),
      timestamp: new Date().toISOString(),
    });
    this.recordedSessions.set(sessionId, entries.slice(0, 100));
    return result;
  }

  async executeDbQuery(
    connectionUrl: string | undefined,
    sql: string,
  ): Promise<{ rows: unknown[]; durationMs: number }> {
    if (!sql?.trim()) {
      throw new BadRequestException('SQL query is required');
    }
    const client = new PrismaClient(
      connectionUrl?.trim()
        ? { datasources: { db: { url: connectionUrl.trim() } } }
        : undefined,
    );
    const start = performance.now();
    try {
      const rows = (await client.$queryRawUnsafe(sql)) as unknown[];
      return {
        rows: Array.isArray(rows) ? rows : [],
        durationMs: Math.round(performance.now() - start),
      };
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Database query failed',
      );
    } finally {
      await client.$disconnect().catch(() => undefined);
    }
  }
  async execute(payload: ProxyExecuteRequest): Promise<ProxyExecuteResponse> {
    const parsedUrl = await validateTargetUrl(payload.url);

    if (payload.queryParams) {
      for (const [key, value] of Object.entries(payload.queryParams)) {
        if (key) {
          parsedUrl.searchParams.set(key, value ?? '');
        }
      }
    }

    const headers = new Headers();
    if (payload.headers) {
      for (const [key, value] of Object.entries(payload.headers)) {
        if (key.trim()) {
          headers.set(key, value ?? '');
        }
      }
    }

    const builtBody = await this.buildBodyBuffer(payload.method, payload.body, headers);

    if (payload.auth) {
      if (payload.auth.type === 'jwt' && payload.auth.secret) {
        headers.set('authorization', await buildJwtHeader(payload.auth));
      } else if (payload.auth.type === 'hawk' && payload.auth.hawkId) {
        headers.set(
          'authorization',
          buildHawkHeader(payload.auth, payload.method, parsedUrl),
        );
      } else if (payload.auth.type === 'aws' && payload.auth.accessKey) {
        const rawStr = builtBody ? builtBody.toString('utf8') : '';
        applyAwsSigV4Headers(
          payload.auth,
          payload.method,
          parsedUrl,
          headers,
          rawStr,
        );
      } else if (payload.auth.type === 'oauth1' && payload.auth.consumerKey) {
        headers.set(
          'authorization',
          buildOAuth1Header(payload.auth, payload.method, parsedUrl),
        );
      } else if (payload.auth.type === 'ntlm' && payload.auth.username) {
        headers.set(
          'authorization',
          buildNtlmType1Header(payload.auth.domain, payload.auth.workstation),
        );
      }
    }

    const timeoutMs = Math.min(
      Math.max(payload.timeoutMs ?? DEFAULT_TIMEOUT_MS, 500),
      MAX_TIMEOUT_MS,
    );
    const followRedirects = payload.followRedirects ?? true;
    const maxRedirects = Math.min(Math.max(payload.maxRedirects ?? 10, 0), 20);
    const verifySsl = payload.verifySsl ?? true;

    let result = await this.executeHttpWithRedirects(
      parsedUrl,
      payload.method,
      headers,
      builtBody,
      timeoutMs,
      followRedirects,
      maxRedirects,
      verifySsl,
      payload.clientCert,
      payload.tunnelProxy,
    );

    if (
      result.statusCode === 401 &&
      payload.auth?.type === 'digest' &&
      payload.auth.username
    ) {
      const wwwAuth = result.headers['www-authenticate'] ?? '';
      const digestHeader = buildDigestHeader(
        wwwAuth,
        payload.auth.username,
        payload.auth.password ?? '',
        payload.method,
        `${parsedUrl.pathname}${parsedUrl.search}`,
      );
      if (digestHeader) {
        headers.set('authorization', digestHeader);
        result = await this.executeHttpWithRedirects(
          parsedUrl,
          payload.method,
          headers,
          builtBody,
          timeoutMs,
          followRedirects,
          maxRedirects,
          verifySsl,
          payload.clientCert,
        );
      }
    } else if (
      result.statusCode === 401 &&
      payload.auth?.type === 'ntlm' &&
      payload.auth.username
    ) {
      const wwwAuth = result.headers['www-authenticate'] ?? '';
      const ntlmType3 = buildNtlmType3Header(
        wwwAuth,
        payload.auth.username,
        payload.auth.password ?? '',
        payload.auth.domain,
        payload.auth.workstation,
      );
      if (ntlmType3) {
        headers.set('authorization', ntlmType3);
        result = await this.executeHttpWithRedirects(
          parsedUrl,
          payload.method,
          headers,
          builtBody,
          timeoutMs,
          followRedirects,
          maxRedirects,
          verifySsl,
          payload.clientCert,
        );
      }
    }

    const contentType = result.headers['content-type'] ?? '';
    const isBinary = this.isBinaryContentType(contentType);

    return {
      statusCode: result.statusCode,
      statusText: result.statusText,
      durationMs: result.timing.totalMs,
      sizeBytes: result.buffer.byteLength,
      headers: result.headers,
      body: isBinary
        ? result.buffer.toString('base64')
        : result.buffer.toString('utf8'),
      isBase64: isBinary,
      timing: result.timing,
      redirectedUrl: result.redirectedUrl,
    };
  }

  private async openTunnelSocket(
    tunnelProxy: { url: string; username?: string; password?: string },
    targetHost: string,
    targetPort: number,
    isHttps: boolean,
    verifySsl: boolean,
    timeoutMs: number,
  ): Promise<net.Socket | tls.TLSSocket> {
    const proxyUrl = new URL(tunnelProxy.url);
    const proxyPort = Number(proxyUrl.port) || (proxyUrl.protocol.startsWith('socks') ? 1080 : 8080);

    const rawSock = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect({ host: proxyUrl.hostname, port: proxyPort, timeout: timeoutMs }, () => resolve(s));
      s.once('error', reject);
      s.once('timeout', () => {
        s.destroy(new Error('Tunnel proxy connection timed out'));
      });
    });

    if (proxyUrl.protocol.startsWith('socks5')) {
      // SOCKS5 greeting (no-auth or username/password)
      const hasAuth = Boolean(tunnelProxy.username || proxyUrl.username);
      rawSock.write(hasAuth ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]));
      const greet = await new Promise<Buffer>((res, rej) => {
        rawSock.once('data', res);
        rawSock.once('error', rej);
      });
      if (greet[0] !== 0x05 || greet[1] === 0xff) {
        rawSock.destroy();
        throw new BadRequestException('SOCKS5 proxy authentication failed');
      }
      if (greet[1] === 0x02) {
        const u = Buffer.from(tunnelProxy.username || decodeURIComponent(proxyUrl.username));
        const p = Buffer.from(tunnelProxy.password || decodeURIComponent(proxyUrl.password));
        rawSock.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]));
        const authRes = await new Promise<Buffer>((res, rej) => {
          rawSock.once('data', res);
          rawSock.once('error', rej);
        });
        if (authRes[1] !== 0x00) {
          rawSock.destroy();
          throw new BadRequestException('SOCKS5 credentials rejected');
        }
      }
      const hostBuf = Buffer.from(targetHost);
      const reqBuf = Buffer.alloc(7 + hostBuf.length);
      reqBuf[0] = 0x05; reqBuf[1] = 0x01; reqBuf[2] = 0x00; reqBuf[3] = 0x03;
      reqBuf[4] = hostBuf.length;
      hostBuf.copy(reqBuf, 5);
      reqBuf.writeUInt16BE(targetPort, 5 + hostBuf.length);
      rawSock.write(reqBuf);
      const connRes = await new Promise<Buffer>((res, rej) => {
        rawSock.once('data', res);
        rawSock.once('error', rej);
      });
      if (connRes[1] !== 0x00) {
        rawSock.destroy();
        throw new BadRequestException(`SOCKS5 connect failed (code ${connRes[1]})`);
      }
    } else {
      // HTTP CONNECT tunnel
      const authUser = tunnelProxy.username || decodeURIComponent(proxyUrl.username || '');
      const authPass = tunnelProxy.password || decodeURIComponent(proxyUrl.password || '');
      const authHeader = authUser
        ? `Proxy-Authorization: Basic ${Buffer.from(`${authUser}:${authPass}`).toString('base64')}\r\n`
        : '';
      rawSock.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${authHeader}\r\n`,
      );
      const connRes = await new Promise<string>((res, rej) => {
        rawSock.once('data', (d) => res(d.toString('utf8')));
        rawSock.once('error', rej);
      });
      if (!/^HTTP\/1\.[01]\s+200/i.test(connRes)) {
        rawSock.destroy();
        throw new BadRequestException(`HTTP proxy CONNECT failed: ${connRes.split('\r\n')[0]}`);
      }
    }

    if (isHttps) {
      return tls.connect({
        socket: rawSock,
        servername: targetHost,
        rejectUnauthorized: verifySsl,
      });
    }
    return rawSock;
  }

  private async executeHttpWithRedirects(
    targetUrl: URL,
    method: string,
    headers: Headers,
    bodyBuffer: Buffer | undefined,
    timeoutMs: number,
    followRedirects: boolean,
    maxRedirects: number,
    verifySsl: boolean,
    clientCert?: ClientCertConfig,
    tunnelProxy?: { url: string; username?: string; password?: string },
  ): Promise<{
    statusCode: number;
    statusText: string;
    headers: Record<string, string>;
    buffer: Buffer;
    timing: ResponseTiming;
    redirectedUrl?: string;
  }> {
    let currentUrl = targetUrl;
    let currentMethod = method;
    let currentBody = bodyBuffer;

    for (let hop = 0; hop <= maxRedirects; hop++) {
      const res = await this.singleNodeRequest(
        currentUrl,
        currentMethod,
        headers,
        currentBody,
        timeoutMs,
        verifySsl,
        clientCert,
        tunnelProxy,
      );

      const isRedirect =
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        Boolean(res.headers['location']);

      if (!followRedirects || !isRedirect || hop === maxRedirects) {
        return {
          ...res,
          redirectedUrl:
            currentUrl.toString() !== targetUrl.toString()
              ? currentUrl.toString()
              : undefined,
        };
      }

      const nextUrlStr = new URL(
        res.headers['location'],
        currentUrl,
      ).toString();
      currentUrl = await validateTargetUrl(nextUrlStr);
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
        currentMethod = 'GET';
        currentBody = undefined;
      }
    }

    throw new BadRequestException('Too many redirects');
  }

  private singleNodeRequest(
    targetUrl: URL,
    method: string,
    headers: Headers,
    bodyBuffer: Buffer | undefined,
    timeoutMs: number,
    verifySsl: boolean,
    clientCert?: ClientCertConfig,
    tunnelProxy?: { url: string; username?: string; password?: string },
  ): Promise<{
    statusCode: number;
    statusText: string;
    headers: Record<string, string>;
    buffer: Buffer;
    timing: ResponseTiming;
  }> {
    return new Promise((resolve, reject) => {
      const isHttps = targetUrl.protocol === 'https:';
      const plainHeaders: Record<string, string> = {};
      headers.forEach((v, k) => {
        plainHeaders[k] = v;
      });
      if (bodyBuffer && !plainHeaders['content-length']) {
        plainHeaders['content-length'] = String(bodyBuffer.byteLength);
      }

      const startAt = performance.now();
      let dnsAt = startAt;
      let tcpAt = startAt;
      let tlsAt = startAt;
      let firstByteAt = startAt;
      let remoteIp: string | undefined;
      let tlsProtocol: string | undefined;

      const targetPort = Number(targetUrl.port) || (isHttps ? 443 : 80);
      const customAgent = tunnelProxy?.url
        ? new (isHttps ? https.Agent : http.Agent)({ keepAlive: false })
        : undefined;
      if (customAgent && tunnelProxy?.url) {
        (customAgent as unknown as { createConnection: (opts: unknown, cb: (err: Error | null, sock?: net.Socket) => void) => void }).createConnection = (
          _opts,
          cb,
        ) => {
          this.openTunnelSocket(
            tunnelProxy,
            targetUrl.hostname,
            targetPort,
            isHttps,
            verifySsl,
            timeoutMs,
          )
            .then((sock) => cb(null, sock))
            .catch((err: Error) => cb(err));
        };
      }

      const options: https.RequestOptions = {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetPort,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method,
        headers: plainHeaders,
        timeout: timeoutMs,
        ...(customAgent ? { agent: customAgent } : {}),
        ...(isHttps
          ? {
              rejectUnauthorized: verifySsl,
              ...(clientCert?.certPem ? { cert: clientCert.certPem } : {}),
              ...(clientCert?.keyPem ? { key: clientCert.keyPem } : {}),
              ...(clientCert?.caPem ? { ca: clientCert.caPem } : {}),
              ...(clientCert?.passphrase
                ? { passphrase: clientCert.passphrase }
                : {}),
            }
          : {}),
      };

      const client = isHttps ? https : http;
      const req = client.request(options, (res) => {
        firstByteAt = performance.now();
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        res.on('data', (chunk: Buffer) => {
          totalBytes += chunk.byteLength;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            req.destroy(
              new BadRequestException(
                `Response exceeded maximum allowed size of ${MAX_RESPONSE_BYTES / (1024 * 1024)} MB`,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          const endAt = performance.now();
          const responseHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) {
              responseHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v);
            }
          }
          const dnsMs = Math.max(0, Math.round(dnsAt - startAt));
          const tcpMs = Math.max(0, Math.round(tcpAt - dnsAt));
          const tlsMs = isHttps ? Math.max(0, Math.round(tlsAt - tcpAt)) : 0;
          const ttfbMs = Math.max(
            0,
            Math.round(firstByteAt - (isHttps ? tlsAt : tcpAt)),
          );
          const downloadMs = Math.max(0, Math.round(endAt - firstByteAt));
          const totalMs = Math.max(1, Math.round(endAt - startAt));

          resolve({
            statusCode: res.statusCode ?? 200,
            statusText: res.statusMessage ?? '',
            headers: responseHeaders,
            buffer: Buffer.concat(chunks),
            timing: {
              dnsMs,
              tcpMs,
              tlsMs,
              ttfbMs,
              downloadMs,
              totalMs,
              remoteIp,
              tlsProtocol,
            },
          });
        });
      });

      req.on('socket', (socket) => {
        socket.on('lookup', (_err, address) => {
          dnsAt = performance.now();
          if (address) remoteIp = address;
        });
        socket.on('connect', () => {
          tcpAt = performance.now();
          if (!remoteIp && socket.remoteAddress) {
            remoteIp = socket.remoteAddress;
          }
        });
        if (isHttps) {
          socket.on('secureConnect', () => {
            tlsAt = performance.now();
            const tlsSock = socket as TLSSocket;
            tlsProtocol = tlsSock.getProtocol?.() ?? undefined;
          });
        }
      });

      req.on('timeout', () => {
        req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
      });

      req.on('error', (err) => {
        if (err instanceof BadRequestException) {
          reject(err);
        } else {
          reject(
            new BadRequestException(`Upstream request failed: ${err.message}`),
          );
        }
      });

      if (bodyBuffer) {
        req.write(bodyBuffer);
      }
      req.end();
    });
  }

  async fetchSpecText(
    rawUrl: string,
  ): Promise<{ content: string; contentType: string }> {
    if (!rawUrl?.trim()) {
      throw new BadRequestException('Spec URL is required');
    }
    const parsedUrl = await validateTargetUrl(rawUrl.trim());
    const response = await fetch(parsedUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json, application/yaml, text/yaml, text/plain, */*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      throw new BadRequestException(
        `Failed to fetch spec (${response.status})`,
      );
    }
    const content = await response.text();
    if (content.length > 5 * 1024 * 1024) {
      throw new BadRequestException('Spec exceeds 5 MB limit');
    }
    return {
      content,
      contentType: response.headers.get('content-type') ?? 'text/plain',
    };
  }

  async importFromGitRepo(
    rawRepoUrl: string,
    branchOverride?: string,
    pathOverride?: string,
  ): Promise<{ files: Array<{ path: string; name: string; content: string }> }> {
    const trimmed = rawRepoUrl?.trim();
    if (!trimmed) {
      throw new BadRequestException('Git repository URL is required');
    }
    const parsed = await validateTargetUrl(trimmed);

    // Direct raw file URL
    if (
      parsed.hostname === 'raw.githubusercontent.com' ||
      /\.(json|yaml|yml|bru|har)$/i.test(parsed.pathname)
    ) {
      const res = await fetch(parsed.toString(), {
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        throw new BadRequestException(`Failed to fetch file (${res.status})`);
      }
      const content = await res.text();
      const name = parsed.pathname.split('/').pop() || 'collection.json';
      return { files: [{ path: name, name, content }] };
    }

    // GitHub repository URL: https://github.com/owner/repo(/tree/branch/subpath)
    if (parsed.hostname === 'github.com') {
      const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
      if (parts.length < 2) {
        throw new BadRequestException('Invalid GitHub repository URL');
      }
      const owner = parts[0];
      const repo = parts[1].replace(/\.git$/i, '');
      let branch = branchOverride?.trim() || '';
      let subPath = pathOverride?.trim().replace(/^\/+|\/+$/g, '') || '';

      if (parts[2] === 'tree' && parts[3]) {
        if (!branch) branch = parts[3];
        if (!subPath && parts.length > 4) {
          subPath = parts.slice(4).join('/');
        }
      }

      if (!branch) {
        const repoRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}`,
          {
            headers: { 'User-Agent': 'Api-Open' },
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (!repoRes.ok) {
          throw new BadRequestException(
            `GitHub repo lookup failed (${repoRes.status})`,
          );
        }
        const repoInfo = (await repoRes.json()) as { default_branch?: string };
        branch = repoInfo.default_branch || 'main';
      }

      const treeRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
        {
          headers: { 'User-Agent': 'Api-Open' },
          signal: AbortSignal.timeout(12_000),
        },
      );
      if (!treeRes.ok) {
        throw new BadRequestException(
          `Failed to list GitHub repository tree (${treeRes.status})`,
        );
      }
      const treeData = (await treeRes.json()) as {
        tree?: Array<{ path: string; type: string }>;
      };
      const matching = (treeData.tree ?? [])
        .filter((item) => {
          if (item.type !== 'blob') return false;
          if (subPath && !item.path.startsWith(`${subPath}/`) && item.path !== subPath) {
            return false;
          }
          return /\.(json|yaml|yml|bru|har)$/i.test(item.path) &&
            !item.path.endsWith('package.json') &&
            !item.path.endsWith('package-lock.json') &&
            !item.path.endsWith('tsconfig.json');
        })
        .slice(0, 40);

      const files: Array<{ path: string; name: string; content: string }> = [];
      for (const item of matching) {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${item.path}`;
        const fRes = await fetch(rawUrl, { signal: AbortSignal.timeout(8_000) });
        if (fRes.ok) {
          files.push({
            path: item.path,
            name: item.path.split('/').pop() || item.path,
            content: await fRes.text(),
          });
        }
      }
      return { files };
    }

    throw new BadRequestException(
      'Supported Git URLs: GitHub repo URLs (https://github.com/owner/repo) or direct raw file URLs.',
    );
  }

  async executeNativeGrpc(params: {
    target: string;
    service: string;
    method: string;
    protoText: string;
    payloadJson: string;
    useTls?: boolean;
  }): Promise<{ statusCode: number; durationMs: number; body: string }> {
    if (!params.target?.trim() || !params.service?.trim() || !params.method?.trim()) {
      throw new BadRequestException('Target host, service, and method are required');
    }
    if (!params.protoText?.trim()) {
      throw new BadRequestException('.proto schema text is required');
    }

    let root: protobuf.Root;
    try {
      root = protobuf.parse(params.protoText).root;
    } catch (err) {
      throw new BadRequestException(
        `Invalid .proto syntax: ${err instanceof Error ? err.message : 'parse error'}`,
      );
    }

    const svc = root.lookupService(params.service.trim());
    const rpc = svc.methods[params.method.trim()];
    if (!rpc) {
      throw new BadRequestException(
        `RPC "${params.method}" not found in service "${params.service}"`,
      );
    }
    rpc.resolve();

    const ReqType = root.lookupType(rpc.requestType);
    const ResType = root.lookupType(rpc.responseType);
    const payloadObj = params.payloadJson?.trim()
      ? (JSON.parse(params.payloadJson) as Record<string, unknown>)
      : {};

    const creds = params.useTls
      ? grpc.credentials.createSsl()
      : grpc.credentials.createInsecure();
    const client = new grpc.Client(params.target.trim(), creds);
    const fullPath = `/${params.service.trim()}/${params.method.trim()}`;
    const start = performance.now();

    return new Promise((resolve, reject) => {
      client.makeUnaryRequest(
        fullPath,
        (arg: Record<string, unknown>) =>
          Buffer.from(ReqType.encode(ReqType.fromObject(arg)).finish()),
        (buf: Buffer) =>
          ResType.toObject(ResType.decode(buf), {
            longs: String,
            enums: String,
            defaults: true,
          }),
        payloadObj,
        (err, response) => {
          const durationMs = Math.round(performance.now() - start);
          client.close();
          if (err) {
            reject(
              new BadRequestException(`gRPC error (${err.code}): ${err.details || err.message}`),
            );
            return;
          }
          resolve({
            statusCode: 0,
            durationMs,
            body: JSON.stringify(response ?? {}, null, 2),
          });
        },
      );
    });
  }

  async reflectGrpcServer(params: {
    target: string;
    useTls?: boolean;
  }): Promise<{
    services: string[];
    methods: Array<{ service: string; name: string }>;
    protoText: string;
  }> {
    if (!params.target?.trim()) {
      throw new BadRequestException('Target gRPC host:port is required');
    }

    const reflectionProto = `
      syntax = "proto3";
      package grpc.reflection.v1alpha;
      service ServerReflection {
        rpc ServerReflectionInfo(stream ServerReflectionRequest) returns (stream ServerReflectionResponse);
      }
      message ServerReflectionRequest {
        string host = 1;
        oneof message_request {
          string file_by_filename = 3;
          string file_containing_symbol = 4;
          string list_services = 7;
        }
      }
      message ServerReflectionResponse {
        string valid_host = 1;
        oneof message_response {
          FileDescriptorResponse file_descriptor_response = 4;
          ListServiceResponse list_services_response = 6;
          ErrorResponse error_response = 7;
        }
      }
      message FileDescriptorResponse { repeated bytes file_descriptor_proto = 1; }
      message ListServiceResponse { repeated ServiceResponse service = 1; }
      message ServiceResponse { string name = 1; }
      message ErrorResponse { int32 error_code = 1; string error_message = 2; }
    `;

    const reflRoot = protobuf.parse(reflectionProto).root;
    const ReqType = reflRoot.lookupType('grpc.reflection.v1alpha.ServerReflectionRequest');
    const ResType = reflRoot.lookupType('grpc.reflection.v1alpha.ServerReflectionResponse');

    const creds = params.useTls
      ? grpc.credentials.createSsl()
      : grpc.credentials.createInsecure();
    const client = new grpc.Client(params.target.trim(), creds);

    const callReflection = (methodPath: string, reqObj: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const stream = client.makeBidiStreamRequest(
          methodPath,
          (arg: Record<string, unknown>) =>
            Buffer.from(ReqType.encode(ReqType.fromObject(arg)).finish()),
          (buf: Buffer) =>
            ResType.toObject(ResType.decode(buf), { longs: String, enums: String }),
        );
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            stream.cancel();
            reject(new Error('gRPC reflection timed out'));
          }
        }, 8000);
        stream.on('data', (data: Record<string, unknown>) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            stream.end();
            resolve(data);
          }
        });
        stream.on('error', (err: Error) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        });
        stream.write(reqObj);
      });

    try {
      let pathUsed = '/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo';
      let listRes: Record<string, unknown>;
      try {
        listRes = await callReflection(pathUsed, { listServices: '*' });
      } catch {
        pathUsed = '/grpc.reflection.v1.ServerReflection/ServerReflectionInfo';
        listRes = await callReflection(pathUsed, { listServices: '*' });
      }

      const listResp = listRes.listServicesResponse as
        | { service?: Array<{ name?: string }> }
        | undefined;
      const services = (listResp?.service ?? [])
        .map((s) => s.name ?? '')
        .filter((name) => name && !name.startsWith('grpc.reflection.'));

      const methods: Array<{ service: string; name: string }> = [];
      const protoLines: string[] = ['syntax = "proto3";', ''];

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const descriptorExt = require('protobufjs/ext/descriptor') as {
        FileDescriptorProto?: { decode: (b: Uint8Array) => Record<string, unknown> };
      };

      for (const svcName of services) {
        try {
          const symRes = await callReflection(pathUsed, {
            fileContainingSymbol: svcName,
          });
          const fdList =
            (symRes.fileDescriptorResponse as { fileDescriptorProto?: Uint8Array[] })
              ?.fileDescriptorProto ?? [];
          for (const rawFd of fdList) {
            if (!descriptorExt.FileDescriptorProto) continue;
            const fd = descriptorExt.FileDescriptorProto.decode(
              rawFd instanceof Uint8Array ? rawFd : new Uint8Array(rawFd),
            ) as {
              package?: string;
              service?: Array<{
                name?: string;
                method?: Array<{ name?: string; inputType?: string; outputType?: string }>;
              }>;
              messageType?: Array<{
                name?: string;
                field?: Array<{ name?: string; number?: number; type?: number }>;
              }>;
            };
            const pkgPrefix = fd.package ? `${fd.package}.` : '';
            for (const msg of fd.messageType ?? []) {
              if (!msg.name) continue;
              protoLines.push(`message ${msg.name} {`);
              for (const f of msg.field ?? []) {
                if (f.name && f.number) {
                  protoLines.push(`  string ${f.name} = ${f.number};`);
                }
              }
              protoLines.push('}');
            }
            for (const svc of fd.service ?? []) {
              const fullSvc = `${pkgPrefix}${svc.name ?? ''}`;
              protoLines.push(`service ${svc.name ?? 'Service'} {`);
              for (const m of svc.method ?? []) {
                if (!m.name) continue;
                methods.push({ service: fullSvc, name: m.name });
                const inType = (m.inputType ?? 'Empty').split('.').pop() || 'Empty';
                const outType = (m.outputType ?? 'Empty').split('.').pop() || 'Empty';
                protoLines.push(`  rpc ${m.name}(${inType}) returns (${outType});`);
              }
              protoLines.push('}');
            }
          }
        } catch {
          // skip unreadable service descriptor
        }
      }

      return {
        services,
        methods,
        protoText: protoLines.join('\n'),
      };
    } catch (err) {
      throw new BadRequestException(
        `gRPC reflection failed: ${err instanceof Error ? err.message : 'unavailable'}`,
      );
    } finally {
      client.close();
    }
  }

  async fetchImage(rawUrl: string): Promise<{
    buffer: Buffer;
    contentType: string;
  }> {
    if (!rawUrl?.trim()) {
      throw new BadRequestException('Image URL is required');
    }
    const parsedUrl = await validateTargetUrl(rawUrl.trim());
    const response = await fetch(parsedUrl.toString(), {
      method: 'GET',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent': 'Api-Open-Image-Proxy/1.0',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new BadRequestException(
        `Failed to fetch image (${response.status})`,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    const lowerCt = contentType.toLowerCase();
    if (
      !lowerCt.startsWith('image/') &&
      !lowerCt.includes('application/octet-stream')
    ) {
      throw new BadRequestException('Target URL did not return an image');
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
      throw new BadRequestException('Image exceeds maximum 5 MB limit');
    }

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: contentType.split(';')[0].trim() || 'image/png',
    };
  }

  private async buildBodyBuffer(
    method: string,
    bodyConfig: BodyConfig | undefined,
    headers: Headers,
  ): Promise<Buffer | undefined> {
    if (!bodyConfig || bodyConfig.mode === 'none') return undefined;
    if (method === 'GET' || method === 'HEAD') return undefined;

    switch (bodyConfig.mode) {
      case 'raw': {
        if (!headers.has('content-type')) {
          const mimeMap: Record<string, string> = {
            json: 'application/json',
            xml: 'application/xml',
            html: 'text/html',
            text: 'text/plain',
          };
          headers.set(
            'content-type',
            mimeMap[bodyConfig.rawType ?? 'text'] ?? 'text/plain',
          );
        }
        return Buffer.from(bodyConfig.raw ?? '', 'utf8');
      }
      case 'urlencoded': {
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/x-www-form-urlencoded');
        }
        const params = new URLSearchParams();
        for (const item of bodyConfig.urlencoded ?? []) {
          if (item.enabled && item.key) {
            params.append(item.key, item.value ?? '');
          }
        }
        return Buffer.from(params.toString(), 'utf8');
      }
      case 'form-data': {
        headers.delete('content-type');
        const form = new FormData();
        for (const item of bodyConfig.formData ?? []) {
          if (!item.enabled || !item.key) continue;
          if (item.type === 'file' && item.fileContentBase64) {
            const buf = Buffer.from(item.fileContentBase64, 'base64');
            const blob = new Blob([buf], {
              type: item.mimeType || 'application/octet-stream',
            });
            form.append(item.key, blob, item.fileName || 'file');
          } else {
            form.append(item.key, item.value ?? '');
          }
        }
        const req = new Request('http://localhost', { method: 'POST', body: form });
        const ct = req.headers.get('content-type');
        if (ct) headers.set('content-type', ct);
        return Buffer.from(await req.arrayBuffer());
      }
      case 'binary': {
        if (!bodyConfig.binary?.contentBase64) return undefined;
        if (!headers.has('content-type')) {
          headers.set(
            'content-type',
            bodyConfig.binary.mimeType || 'application/octet-stream',
          );
        }
        return Buffer.from(bodyConfig.binary.contentBase64, 'base64');
      }
      case 'graphql': {
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/json');
        }
        let parsedVars: Record<string, unknown> = {};
        if (bodyConfig.graphql?.variables?.trim()) {
          try {
            parsedVars = JSON.parse(bodyConfig.graphql.variables);
          } catch {
            throw new BadRequestException('GraphQL variables must be valid JSON');
          }
        }
        return Buffer.from(
          JSON.stringify({
            query: bodyConfig.graphql?.query ?? '',
            variables: parsedVars,
          }),
          'utf8',
        );
      }
      default:
        return undefined;
    }
  }

  private isBinaryContentType(contentType: string): boolean {
    const lower = contentType.toLowerCase();
    if (!lower) return false;
    return (
      lower.startsWith('image/') ||
      lower.startsWith('audio/') ||
      lower.startsWith('video/') ||
      lower.includes('application/octet-stream') ||
      lower.includes('application/pdf') ||
      lower.includes('application/zip')
    );
  }
}
