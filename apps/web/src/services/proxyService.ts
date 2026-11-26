import type {
  AuthConfig,
  ProxyExecuteRequest,
  ProxyExecuteResponse,
} from '@api-open/shared';
import {
  type GqlFieldSummary,
  GRAPHQL_INTROSPECTION_QUERY,
  parseIntrospectionResponse,
} from '../utils/graphqlIntrospection';
import { resolveVariables } from '../utils/variables';
import { API_BASE } from './httpClient';

export function resolveImageProxyUrl(
  url?: string | null,
): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  if (
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('/')
  ) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return `${API_BASE}/proxy/image?url=${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
}

export interface DesktopBridge {
  isDesktop?: boolean;
  executeRequest?: (
    payload: ProxyExecuteRequest,
  ) => Promise<ProxyExecuteResponse>;
}

export function isDesktopAgentAvailable(): boolean {
  const win = window as unknown as { apiOpenDesktop?: DesktopBridge };
  return Boolean(win.apiOpenDesktop?.executeRequest);
}

export async function executeDesktopDirectRequest(
  payload: ProxyExecuteRequest,
): Promise<ProxyExecuteResponse> {
  const win = window as unknown as { apiOpenDesktop?: DesktopBridge };
  if (!win.apiOpenDesktop?.executeRequest) {
    throw new Error('Desktop Local Proxy is not available');
  }
  return win.apiOpenDesktop.executeRequest(payload);
}

export async function executeProxyRequest(
  payload: ProxyExecuteRequest,
): Promise<ProxyExecuteResponse> {
  const res = await fetch(`${API_BASE}/proxy/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const errBody = await res.json();
      if (errBody?.message) {
        message = Array.isArray(errBody.message)
          ? errBody.message.join(', ')
          : errBody.message;
      }
    } catch {
      // ignore JSON parse error
    }
    throw new Error(message);
  }

  return res.json() as Promise<ProxyExecuteResponse>;
}

async function tryExtensionFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<ProxyExecuteResponse | null> {
  const win = window as unknown as { __API_OPEN_EXTENSION__?: boolean };
  if (!win.__API_OPEN_EXTENSION__) return null;
  const requestId = Math.random().toString(36).slice(2, 12);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMsg);
      resolve(null);
    }, 15000);
    function onMsg(event: MessageEvent) {
      if (
        event.source !== window ||
        !event.data ||
        event.data.type !== 'API_OPEN_EXT_RESPONSE' ||
        event.data.requestId !== requestId
      ) {
        return;
      }
      window.clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      const resp = event.data.response;
      if (resp?.ok) resolve(resp.result as ProxyExecuteResponse);
      else reject(new Error(resp?.error || 'Extension request failed'));
    }
    window.addEventListener('message', onMsg);
    window.postMessage(
      {
        type: 'API_OPEN_EXT_REQUEST',
        requestId,
        payload: { url, method, headers, body },
      },
      '*',
    );
  });
}

export async function executeBrowserDirectRequest(
  payload: ProxyExecuteRequest,
): Promise<ProxyExecuteResponse> {
  const target = new URL(payload.url);
  if (payload.queryParams) {
    for (const [k, v] of Object.entries(payload.queryParams)) {
      if (k) target.searchParams.set(k, v ?? '');
    }
  }

  const headers = new Headers(payload.headers ?? {});
  let body: BodyInit | undefined;
  const method = payload.method;

  if (method !== 'GET' && method !== 'HEAD' && payload.body) {
    if (payload.body.mode === 'raw') {
      body = payload.body.raw ?? '';
      if (!headers.has('content-type') && payload.body.rawType === 'json') {
        headers.set('content-type', 'application/json');
      }
    } else if (payload.body.mode === 'urlencoded') {
      const p = new URLSearchParams();
      for (const row of payload.body.urlencoded ?? []) {
        if (row.enabled && row.key) p.append(row.key, row.value ?? '');
      }
      body = p.toString();
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/x-www-form-urlencoded');
      }
    } else if (payload.body.mode === 'graphql') {
      body = JSON.stringify({
        query: payload.body.graphql?.query ?? '',
        variables: payload.body.graphql?.variables
          ? JSON.parse(payload.body.graphql.variables || '{}')
          : {},
      });
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
    }
  }

  const plainHeaders: Record<string, string> = {};
  headers.forEach((v, k) => {
    plainHeaders[k] = v;
  });
  const extRes = await tryExtensionFetch(
    target.toString(),
    method,
    plainHeaders,
    typeof body === 'string' ? body : undefined,
  );
  if (extRes) return extRes;

  const start = performance.now();
  const res = await fetch(target.toString(), { method, headers, body });

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    responseHeaders[k] = v;
  });

  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  const isBinary =
    contentType.startsWith('image/') ||
    contentType.startsWith('audio/') ||
    contentType.startsWith('video/') ||
    contentType.includes('application/octet-stream') ||
    contentType.includes('application/pdf') ||
    contentType.includes('application/zip');

  const arrayBuffer = await res.arrayBuffer();
  const durationMs = Math.round(performance.now() - start);
  let resBody = '';
  if (isBinary) {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    resBody = btoa(binary);
  } else {
    resBody = new TextDecoder().decode(arrayBuffer);
  }

  return {
    statusCode: res.status,
    statusText: res.statusText,
    durationMs,
    sizeBytes: arrayBuffer.byteLength,
    headers: responseHeaders,
    body: resBody,
    isBase64: isBinary,
  };
}

export async function introspectGraphqlEndpoint(
  rawUrl: string,
  variablesMap: Record<string, string>,
): Promise<{ queries: GqlFieldSummary[]; mutations: GqlFieldSummary[] }> {
  const resolvedUrl = resolveVariables(rawUrl.trim(), variablesMap);
  const res = await executeProxyRequest({
    method: 'POST',
    url: resolvedUrl,
    headers: { 'Content-Type': 'application/json' },
    body: {
      mode: 'graphql',
      graphql: { query: GRAPHQL_INTROSPECTION_QUERY, variables: '{}' },
    },
  });
  return parseIntrospectionResponse(res.body);
}

export async function exchangeOAuth2ClientCredentials(
  auth: Extract<AuthConfig, { type: 'oauth2' }>,
  variablesMap: Record<string, string>,
): Promise<string> {
  const r = (v?: string) => resolveVariables(v || '', variablesMap);
  const res = await executeProxyRequest({
    method: 'POST',
    url: r(auth.tokenUrl?.trim()),
    body: {
      mode: 'urlencoded',
      urlencoded: [
        { id: '1', key: 'grant_type', value: 'client_credentials', enabled: true },
        { id: '2', key: 'client_id', value: r(auth.clientId), enabled: Boolean(auth.clientId) },
        { id: '3', key: 'client_secret', value: r(auth.clientSecret), enabled: Boolean(auth.clientSecret) },
        { id: '4', key: 'scope', value: r(auth.scope), enabled: Boolean(auth.scope) },
      ],
    },
  });
  const parsed = JSON.parse(res.body) as { access_token?: string };
  if (!parsed.access_token) {
    throw new Error('Response did not include access_token');
  }
  return parsed.access_token;
}

export async function fetchRemoteSpecText(url: string): Promise<string> {
  const res = await fetch(`${API_BASE}/proxy/fetch-spec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message || `Failed to fetch spec (${res.status})`);
  }
  const data = (await res.json()) as { content: string };
  return data.content;
}

export async function executeDbQuery(
  connectionUrl: string | undefined,
  sql: string,
): Promise<{ rows: unknown[]; durationMs: number }> {
  const res = await fetch(`${API_BASE}/proxy/db-query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionUrl, sql }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message || `Query failed (${res.status})`);
  }
  return res.json() as Promise<{ rows: unknown[]; durationMs: number }>;
}

export async function getRecordedTraffic(sessionId: string) {
  const res = await fetch(`${API_BASE}/proxy/record/${sessionId}`);
  if (!res.ok) return [];
  return res.json() as Promise<
    Array<{
      id: string;
      method: string;
      url: string;
      headers: Record<string, string>;
      body: string;
      statusCode: number;
      durationMs: number;
      responseBody: string;
      timestamp: string;
    }>
  >;
}

export async function clearRecordedTraffic(sessionId: string) {
  await fetch(`${API_BASE}/proxy/record/${sessionId}`, { method: 'DELETE' });
}

export async function importFromGitRepo(
  repoUrl: string,
  branch?: string,
  path?: string,
): Promise<Array<{ path: string; name: string; content: string }>> {
  const res = await fetch(`${API_BASE}/proxy/git-import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoUrl, branch, path }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message || `Git import failed (${res.status})`);
  }
  const data = (await res.json()) as {
    files: Array<{ path: string; name: string; content: string }>;
  };
  return data.files ?? [];
}

export async function executeNativeGrpc(payload: {
  target: string;
  service: string;
  method: string;
  protoText: string;
  payloadJson: string;
  useTls?: boolean;
}): Promise<{ statusCode: number; durationMs: number; body: string }> {
  const res = await fetch(`${API_BASE}/proxy/grpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message || `gRPC call failed (${res.status})`);
  }
  return res.json() as Promise<{ statusCode: number; durationMs: number; body: string }>;
}

export async function reflectGrpcServer(payload: {
  target: string;
  useTls?: boolean;
}): Promise<{
  services: string[];
  methods: Array<{ service: string; name: string }>;
  protoText: string;
}> {
  const res = await fetch(`${API_BASE}/proxy/grpc-reflect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message || `gRPC reflection failed (${res.status})`);
  }
  return res.json() as Promise<{
    services: string[];
    methods: Array<{ service: string; name: string }>;
    protoText: string;
  }>;
}
