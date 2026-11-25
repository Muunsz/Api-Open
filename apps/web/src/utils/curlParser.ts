import type { AuthConfig, BodyConfig, HttpMethod, KeyValueItem } from '@api-open/shared';

export interface ParsedCurl {
  method: HttpMethod;
  url: string;
  headers: KeyValueItem[];
  auth: AuthConfig;
  body: BodyConfig;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Tokenizes a shell command respecting single quotes, double quotes, and backslash escapes.
 */
function tokenizeShell(command: string): string[] {
  const cleaned = command.replace(/\\\r?\n/g, ' ').trim();
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < cleaned.length) {
        current += cleaned[++i];
      } else if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else if (ch === '\\' && i + 1 < cleaned.length) {
      current += cleaned[++i];
    } else {
      current += ch;
    }
  }

  if (current) tokens.push(current);
  return tokens;
}

const VALID_METHODS = new Set<HttpMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

export function parseCurlCommand(raw: string): ParsedCurl {
  const tokens = tokenizeShell(raw);
  if (!tokens.length || tokens[0].toLowerCase() !== 'curl') {
    throw new Error('Command must start with "curl"');
  }

  let method: HttpMethod | null = null;
  let url = '';
  const headers: KeyValueItem[] = [];
  let auth: AuthConfig = { type: 'none' };
  const dataParts: string[] = [];
  let isUrlEncoded = false;

  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok === '-X' || tok === '--request') {
      const m = (tokens[++i] || 'GET').toUpperCase() as HttpMethod;
      method = VALID_METHODS.has(m) ? m : 'GET';
    } else if (tok === '-H' || tok === '--header') {
      const headerLine = tokens[++i] || '';
      const colonIdx = headerLine.indexOf(':');
      if (colonIdx > 0) {
        const key = headerLine.slice(0, colonIdx).trim();
        const value = headerLine.slice(colonIdx + 1).trim();
        if (key.toLowerCase() === 'content-type' && value.includes('application/x-www-form-urlencoded')) {
          isUrlEncoded = true;
        }
        headers.push({ id: uid(), key, value, enabled: true });
      }
    } else if (tok === '-d' || tok === '--data' || tok === '--data-raw' || tok === '--data-binary') {
      dataParts.push(tokens[++i] || '');
    } else if (tok === '--data-urlencode') {
      isUrlEncoded = true;
      dataParts.push(tokens[++i] || '');
    } else if (tok === '-u' || tok === '--user') {
      const creds = tokens[++i] || '';
      const sep = creds.indexOf(':');
      auth = {
        type: 'basic',
        username: sep >= 0 ? creds.slice(0, sep) : creds,
        password: sep >= 0 ? creds.slice(sep + 1) : '',
      };
    } else if (tok === '--url') {
      url = tokens[++i] || '';
    } else if (!tok.startsWith('-') && !url) {
      url = tok;
    }
  }

  if (!url) {
    throw new Error('No URL found in cURL command');
  }

  const rawBody = dataParts.join('&');
  if (!method) {
    method = rawBody ? 'POST' : 'GET';
  }

  let body: BodyConfig = { mode: 'none', raw: '', rawType: 'json' };
  if (rawBody) {
    if (isUrlEncoded) {
      const params = new URLSearchParams(rawBody);
      const rows: KeyValueItem[] = [];
      params.forEach((value, key) => {
        rows.push({ id: uid(), key, value, enabled: true });
      });
      body = { mode: 'urlencoded', urlencoded: rows };
    } else {
      let rawType: 'json' | 'xml' | 'html' | 'text' = 'text';
      try {
        JSON.parse(rawBody);
        rawType = 'json';
      } catch {
        if (rawBody.trim().startsWith('<')) rawType = 'xml';
      }
      body = { mode: 'raw', raw: rawBody, rawType };
    }
  }

  return { method, url, headers, auth, body };
}
