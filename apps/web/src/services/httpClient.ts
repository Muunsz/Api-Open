export const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export function getActiveApiBase(): string {
  try {
    const custom = localStorage.getItem('api_open_custom_proxy_v1')?.trim();
    if (custom) return custom.replace(/\/$/, '');
  } catch {
    // ignore
  }
  return API_BASE;
}

export async function apiFetch<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    let msg = `API error ${res.status}`;
    try {
      const err = await res.json();
      if (err?.message) {
        msg = Array.isArray(err.message) ? err.message.join(', ') : err.message;
      }
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(msg);
  }

  return res.json() as Promise<T>;
}
