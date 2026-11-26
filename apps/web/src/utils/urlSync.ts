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

/**
 * Extracts path parameter names from :param or {param} segments in the URL path,
 * ignoring {{envVar}} placeholders, protocol schemes, and numeric port numbers.
 */
export function extractPathParamNames(rawUrl: string): string[] {
  if (!rawUrl) return [];
  const pathOnly = rawUrl.split('?')[0].split('#')[0];
  // Remove {{...}} so {var} inside {{var}} is never treated as a path param
  const withoutMustache = pathOnly.replace(/\{\{[^}]*\}\}/g, '');
  // Strip protocol + host if present, or just protocol
  const afterScheme = withoutMustache.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
  const slashIdx = afterScheme.indexOf('/');
  const pathPart = slashIdx >= 0 ? afterScheme.slice(slashIdx) : afterScheme;

  const found: string[] = [];
  const seen = new Set<string>();
  const regex = /(?:\/:([a-zA-Z_][a-zA-Z0-9_]*))|(?:\{([a-zA-Z_][a-zA-Z0-9_]*)\})/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(pathPart)) !== null) {
    const name = match[1] || match[2];
    if (name && !seen.has(name)) {
      seen.add(name);
      found.push(name);
    }
  }
  return found;
}

/**
 * Replaces :param and {param} placeholders in the URL path with resolved values.
 */
export function applyPathParamsToUrl(
  resolvedUrl: string,
  pathParams: KeyValueItem[],
  resolveFn: (val: string) => string,
): string {
  if (!resolvedUrl || !pathParams?.length) return resolvedUrl;
  const [withoutQuery, ...rest] = resolvedUrl.split('?');
  const suffix = rest.length ? `?${rest.join('?')}` : '';
  let nextPath = withoutQuery;

  for (const param of pathParams) {
    if (!param.enabled || !param.key.trim()) continue;
    const rawVal = resolveFn(param.value ?? '');
    if (rawVal === '') continue;
    const encoded = encodeURIComponent(rawVal);
    const key = param.key.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    nextPath = nextPath.replace(new RegExp(`/:${key}(?=/|$)`, 'g'), `/${encoded}`);
    nextPath = nextPath.replace(new RegExp(`\\{${key}\\}`, 'g'), encoded);
  }
  return `${nextPath}${suffix}`;
}
