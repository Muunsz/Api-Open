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
