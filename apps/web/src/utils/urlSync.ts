import type { KeyValueItem } from '@api-open/shared';

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Extracts query parameters from a raw URL string without corrupting {{variables}}.
 */
export function parseQueryFromUrl(rawUrl: string): KeyValueItem[] {
  const qIndex = rawUrl.indexOf('?');
  if (qIndex === -1) return [];

  const queryStr = rawUrl.slice(qIndex + 1).split('#')[0];
  if (!queryStr) return [];

  return queryStr.split('&').map((part) => {
    const eqIdx = part.indexOf('=');
    const rawKey = eqIdx >= 0 ? part.slice(0, eqIdx) : part;
    const rawVal = eqIdx >= 0 ? part.slice(eqIdx + 1) : '';
    return {
      id: uid(),
      key: safeDecode(rawKey),
      value: safeDecode(rawVal),
      description: '',
      enabled: true,
    };
  });
}

/**
 * Rebuilds the URL string from its base + enabled query parameter rows.
 */
export function buildUrlWithParams(
  rawUrl: string,
  rows: KeyValueItem[],
  encoding: 'auto' | 'enable' | 'disable' = 'auto',
): string {
  const [withoutHash, hash] = rawUrl.split('#');
  const baseUrl = withoutHash.split('?')[0];

  const active = rows.filter((r) => r.enabled && r.key.trim() !== '');
  if (!active.length) {
    return hash !== undefined ? `${baseUrl}#${hash}` : baseUrl;
  }

  const encodeVal = (v: string) => {
    if (encoding === 'disable') return v;
    return encodePreservingVars(v);
  };

  const query = active
    .map((r) => `${encodeVal(r.key.trim())}=${encodeVal(r.value ?? '')}`)
    .join('&');

  const full = `${baseUrl}?${query}`;
  return hash !== undefined ? `${full}#${hash}` : full;
}

function safeDecode(val: string): string {
  try {
    return decodeURIComponent(val.replace(/\+/g, ' '));
  } catch {
    return val;
  }
}

function encodePreservingVars(val: string): string {
  // Keep {{var}} intact while encoding normal special characters
  return val
    .split(/(\{\{[^}]+\}\})/g)
    .map((segment) =>
      segment.startsWith('{{') && segment.endsWith('}}')
        ? segment
        : encodeURIComponent(segment),
    )
    .join('');
}
