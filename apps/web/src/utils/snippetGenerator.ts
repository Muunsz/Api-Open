import type { BodyConfig, HttpMethod } from '@api-open/shared';

export type SnippetLang = 'curl' | 'fetch' | 'axios' | 'go' | 'python';

export interface SnippetInput {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: BodyConfig;
}

function resolveBodyString(input: SnippetInput): string | undefined {
  const { method, body } = input;
  if (!body || body.mode === 'none' || method === 'GET' || method === 'HEAD') {
    return undefined;
  }
  if (body.mode === 'raw') return body.raw ?? '';
  if (body.mode === 'urlencoded') {
    const p = new URLSearchParams();
    for (const row of body.urlencoded ?? []) {
      if (row.enabled && row.key) p.append(row.key, row.value);
    }
    return p.toString();
  }
  if (body.mode === 'graphql') {
    return JSON.stringify({
      query: body.graphql?.query ?? '',
      variables: body.graphql?.variables ? JSON.parse(body.graphql.variables || '{}') : {},
    });
  }
  return undefined;
}

export function generateSnippet(lang: SnippetLang, input: SnippetInput): string {
  const bodyStr = resolveBodyString(input);
  const headers = { ...input.headers };

  switch (lang) {
    case 'curl': {
      const lines = [`curl -X ${input.method} '${input.url}'`];
      for (const [k, v] of Object.entries(headers)) {
        lines.push(`  -H '${k}: ${v}'`);
      }
      if (bodyStr !== undefined) {
        lines.push(`  -d '${bodyStr.replace(/'/g, `'\\''`)}'`);
      }
      return lines.join(' \\\n');
    }

    case 'fetch': {
      const opts: Record<string, unknown> = { method: input.method };
      if (Object.keys(headers).length) opts.headers = headers;
      if (bodyStr !== undefined) opts.body = bodyStr;
      return `const response = await fetch(${JSON.stringify(input.url)}, ${JSON.stringify(opts, null, 2)});\nconst data = await response.json();\nconsole.log(data);`;
    }

    case 'axios': {
      const cfg: Record<string, unknown> = {
        method: input.method,
        url: input.url,
      };
      if (Object.keys(headers).length) cfg.headers = headers;
      if (bodyStr !== undefined) {
        try {
          cfg.data = JSON.parse(bodyStr);
        } catch {
          cfg.data = bodyStr;
        }
      }
      return `import axios from 'axios';\n\nconst { data } = await axios(${JSON.stringify(cfg, null, 2)});\nconsole.log(data);`;
    }

    case 'go': {
      const headerLines = Object.entries(headers)
        .map(([k, v]) => `\treq.Header.Set(${JSON.stringify(k)}, ${JSON.stringify(v)})`)
        .join('\n');
      const bodyInit =
        bodyStr !== undefined
          ? `payload := strings.NewReader(${JSON.stringify(bodyStr)})\n\treq, err := http.NewRequest(${JSON.stringify(input.method)}, ${JSON.stringify(input.url)}, payload)`
          : `req, err := http.NewRequest(${JSON.stringify(input.method)}, ${JSON.stringify(input.url)}, nil)`;

      return `package main\n\nimport (\n\t"fmt"\n\t"io"\n\t"net/http"${bodyStr !== undefined ? '\n\t"strings"' : ''}\n)\n\nfunc main() {\n\t${bodyInit}\n\tif err != nil {\n\t\tpanic(err)\n\t}\n${headerLines ? headerLines + '\n' : ''}\tresp, err := http.DefaultClient.Do(req)\n\tif err != nil {\n\t\tpanic(err)\n\t}\n\tdefer resp.Body.Close()\n\tbody, _ := io.ReadAll(resp.Body)\n\tfmt.Println(string(body))\n}`;
    }

    case 'python': {
      const lines = ['import requests', ''];
      lines.push(`url = ${JSON.stringify(input.url)}`);
      if (Object.keys(headers).length) {
        lines.push(`headers = ${JSON.stringify(headers, null, 2)}`);
      }
      if (bodyStr !== undefined) {
        lines.push(`data = ${JSON.stringify(bodyStr)}`);
      }
      const args = [
        JSON.stringify(input.method),
        'url',
        Object.keys(headers).length ? 'headers=headers' : '',
        bodyStr !== undefined ? 'data=data' : '',
      ]
        .filter(Boolean)
        .join(', ');
      lines.push(`response = requests.request(${args})`);
      lines.push('print(response.text)');
      return lines.join('\n');
    }
  }
}
