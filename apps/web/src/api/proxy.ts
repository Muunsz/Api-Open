import type { ProxyExecuteRequest, ProxyExecuteResponse } from '@api-open/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

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

  const start = performance.now();
  const res = await fetch(target.toString(), { method, headers, body });
  const text = await res.text();
  const durationMs = Math.round(performance.now() - start);

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    responseHeaders[k] = v;
  });

  return {
    statusCode: res.status,
    statusText: res.statusText,
    durationMs,
    sizeBytes: new Blob([text]).size,
    headers: responseHeaders,
    body: text,
    isBase64: false,
  };
}
