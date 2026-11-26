import type { BodyConfig, HttpMethod } from '@api-open/shared';

export type SnippetLang =
  | 'curl'
  | 'fetch'
  | 'axios'
  | 'go'
  | 'python'
  | 'php'
  | 'java'
  | 'csharp'
  | 'ruby'
  | 'rust'
  | 'httpie'
  | 'powershell';

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
      variables: body.graphql?.variables
        ? JSON.parse(body.graphql.variables || '{}')
        : {},
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
        .map(
          ([k, v]) =>
            `\treq.Header.Set(${JSON.stringify(k)}, ${JSON.stringify(v)})`,
        )
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

    case 'php': {
      const hList = Object.entries(headers)
        .map(([k, v]) => `    ${JSON.stringify(`${k}: ${v}`)}`)
        .join(',\n');
      return `<?php\n$curl = curl_init();\ncurl_setopt_array($curl, [\n  CURLOPT_URL => ${JSON.stringify(input.url)},\n  CURLOPT_RETURNTRANSFER => true,\n  CURLOPT_CUSTOMREQUEST => ${JSON.stringify(input.method)},\n${bodyStr !== undefined ? `  CURLOPT_POSTFIELDS => ${JSON.stringify(bodyStr)},\n` : ''}${hList ? `  CURLOPT_HTTPHEADER => [\n${hList}\n  ],\n` : ''}\n]);\n$response = curl_exec($curl);\ncurl_close($curl);\necho $response;`;
    }

    case 'java': {
      const hLines = Object.entries(headers)
        .map(
          ([k, v]) =>
            `  .addHeader(${JSON.stringify(k)}, ${JSON.stringify(v)})`,
        )
        .join('\n');
      return `OkHttpClient client = new OkHttpClient();\n${bodyStr !== undefined ? `RequestBody body = RequestBody.create(${JSON.stringify(bodyStr)}, MediaType.parse("application/json"));\n` : ''}Request request = new Request.Builder()\n  .url(${JSON.stringify(input.url)})\n  .method(${JSON.stringify(input.method)}, ${bodyStr !== undefined ? 'body' : 'null'})\n${hLines ? hLines + '\n' : ''}  .build();\nResponse response = client.newCall(request).execute();\nSystem.out.println(response.body().string());`;
    }

    case 'csharp': {
      const hLines = Object.entries(headers)
        .map(
          ([k, v]) =>
            `request.Headers.TryAddWithoutValidation(${JSON.stringify(k)}, ${JSON.stringify(v)});`,
        )
        .join('\n');
      return `using var client = new HttpClient();\nvar request = new HttpRequestMessage(HttpMethod.${input.method[0] + input.method.slice(1).toLowerCase()}, ${JSON.stringify(input.url)});\n${hLines ? hLines + '\n' : ''}${bodyStr !== undefined ? `request.Content = new StringContent(${JSON.stringify(bodyStr)}, System.Text.Encoding.UTF8, "application/json");\n` : ''}var response = await client.SendAsync(request);\nConsole.WriteLine(await response.Content.ReadAsStringAsync());`;
    }

    case 'ruby': {
      const hLines = Object.entries(headers)
        .map(([k, v]) => `request[${JSON.stringify(k)}] = ${JSON.stringify(v)}`)
        .join('\n');
      return `require 'uri'\nrequire 'net/http'\n\nurl = URI(${JSON.stringify(input.url)})\nhttp = Net::HTTP.new(url.host, url.port)\nhttp.use_ssl = url.scheme == 'https'\nrequest = Net::HTTP::${input.method[0] + input.method.slice(1).toLowerCase()}.new(url)\n${hLines ? hLines + '\n' : ''}${bodyStr !== undefined ? `request.body = ${JSON.stringify(bodyStr)}\n` : ''}response = http.request(request)\nputs response.read_body`;
    }

    case 'rust': {
      const hLines = Object.entries(headers)
        .map(([k, v]) => `        .header(${JSON.stringify(k)}, ${JSON.stringify(v)})`)
        .join('\n');
      return `#[tokio::main]\nasync fn main() -> Result<(), reqwest::Error> {\n    let client = reqwest::Client::new();\n    let res = client\n        .${input.method.toLowerCase()}(${JSON.stringify(input.url)})\n${hLines ? hLines + '\n' : ''}${bodyStr !== undefined ? `        .body(${JSON.stringify(bodyStr)})\n` : ''}        .send()\n        .await?\n        .text()\n        .await?;\n    println!("{}", res);\n    Ok(())\n}`;
    }

    case 'httpie': {
      const args = [`http ${input.method} '${input.url}'`];
      for (const [k, v] of Object.entries(headers)) {
        args.push(`'${k}:${v}'`);
      }
      if (bodyStr !== undefined) {
        return `echo '${bodyStr.replace(/'/g, `'\\''`)}' | ${args.join(' ')}`;
      }
      return args.join(' \\\n  ');
    }

    case 'powershell': {
      const hPairs = Object.entries(headers)
        .map(([k, v]) => `  ${JSON.stringify(k)} = ${JSON.stringify(v)}`)
        .join('\n');
      return `${hPairs ? `$headers = @{\n${hPairs}\n}\n` : ''}Invoke-RestMethod -Uri ${JSON.stringify(input.url)} -Method ${input.method}${hPairs ? ' -Headers $headers' : ''}${bodyStr !== undefined ? ` -Body ${JSON.stringify(bodyStr)}` : ''}`;
    }
  }
}
