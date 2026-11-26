export type AiProviderMode = 'local' | 'gemini' | 'groq' | 'openrouter' | 'ollama';

export interface AiConfig {
  provider: AiProviderMode;
  apiKey?: string;
  model?: string;
  ollamaUrl?: string;
}

export function generateLocalTestsFromResponse(
  statusCode: number,
  bodyText: string,
): string {
  const lines: string[] = [
    `pm.test("Status code is ${statusCode}", () => {`,
    `  pm.expect(pm.response.code).to.equal(${statusCode});`,
    `});`,
    '',
  ];
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (Array.isArray(parsed)) {
      lines.push(`pm.test("Response is an array", () => {`);
      lines.push(`  const data = pm.response.json();`);
      lines.push(`  pm.expect(Array.isArray(data)).to.equal(true);`);
      if (parsed.length > 0 && parsed[0] && typeof parsed[0] === 'object') {
        const firstKeys = Object.keys(parsed[0] as Record<string, unknown>).slice(0, 4);
        for (const k of firstKeys) {
          lines.push(`  pm.expect(data[0]).to.have.property(${JSON.stringify(k)});`);
        }
      }
      lines.push(`});`);
    } else if (parsed && typeof parsed === 'object') {
      const entries = Object.entries(parsed as Record<string, unknown>).slice(0, 6);
      lines.push(`pm.test("Response JSON has expected fields", () => {`);
      lines.push(`  const data = pm.response.json();`);
      for (const [k] of entries) {
        lines.push(`  pm.expect(data).to.have.property(${JSON.stringify(k)});`);
      }
      lines.push(`});`);
    }
  } catch {
    lines.push(`pm.test("Response body is non-empty", () => {`);
    lines.push(`  pm.expect(pm.response.text().length > 0).to.equal(true);`);
    lines.push(`});`);
  }
  return lines.join('\n');
}

export function explainLocalHttpError(statusCode: number, bodyText: string): string {
  const hints: Record<number, string> = {
    400: 'Bad Request (400): Check request JSON syntax, required fields, or query parameter types.',
    401: 'Unauthorized (401): Missing, expired, or invalid credentials/token in the Auth tab or Authorization header.',
    403: 'Forbidden (403): Authenticated, but your account/role lacks permission for this resource.',
    404: 'Not Found (404): Verify the base URL, route path, and path parameters.',
    405: 'Method Not Allowed (405): Check if the HTTP method (GET/POST/PUT/DELETE) matches the endpoint.',
    415: 'Unsupported Media Type (415): Ensure Content-Type header (e.g. application/json) matches the body.',
    422: 'Unprocessable Entity (422): Validation failed on payload fields. Check the response details below.',
    429: 'Too Many Requests (429): Rate limit exceeded. Wait or reduce concurrency in Runner.',
    500: 'Internal Server Error (500): Server-side exception. Inspect backend logs or payload edge cases.',
    502: 'Bad Gateway (502): Upstream server is unreachable or returned an invalid response.',
    503: 'Service Unavailable (503): Target service is overloaded or down for maintenance.',
    504: 'Gateway Timeout (504): Target server took too long to respond. Try increasing request timeout.',
  };
  const base = hints[statusCode] || `HTTP ${statusCode}: Review the response headers and body for details.`;
  const snippet = bodyText.trim().slice(0, 220);
  return snippet ? `${base}\n\nResponse snippet:\n${snippet}` : base;
}

async function callExternalAi(prompt: string, cfg: AiConfig): Promise<string | null> {
  try {
    if (cfg.provider === 'gemini' && cfg.apiKey) {
      const model = cfg.model?.trim() || 'gemini-2.0-flash';
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    }

    if ((cfg.provider === 'groq' || cfg.provider === 'openrouter') && cfg.apiKey) {
      const endpoint =
        cfg.provider === 'groq'
          ? 'https://api.groq.com/openai/v1/chat/completions'
          : 'https://openrouter.ai/api/v1/chat/completions';
      const model =
        cfg.model?.trim() ||
        (cfg.provider === 'groq' ? 'llama-3.1-8b-instant' : 'meta-llama/llama-3.2-3b-instruct:free');
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content?.trim() || null;
    }

    if (cfg.provider === 'ollama') {
      const base = (cfg.ollamaUrl?.trim() || 'http://localhost:11434').replace(/\/$/, '');
      const res = await fetch(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: cfg.model?.trim() || 'llama3.2',
          prompt,
          stream: false,
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { response?: string };
      return data.response?.trim() || null;
    }
  } catch {
    return null;
  }
  return null;
}

export async function aiGenerateTests(
  statusCode: number,
  bodyText: string,
  cfg: AiConfig,
): Promise<string> {
  if (cfg.provider !== 'local') {
    const prompt = `Generate concise Postman-style pm.test(...) JavaScript assertions (no markdown fences) for HTTP ${statusCode} with response body:\n${bodyText.slice(0, 2000)}`;
    const out = await callExternalAi(prompt, cfg);
    if (out) return out.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim();
  }
  return generateLocalTestsFromResponse(statusCode, bodyText);
}

export async function aiExplainError(
  statusCode: number,
  bodyText: string,
  cfg: AiConfig,
): Promise<string> {
  if (cfg.provider !== 'local') {
    const prompt = `Explain concisely why this API returned HTTP ${statusCode} and how to fix it:\n${bodyText.slice(0, 2000)}`;
    const out = await callExternalAi(prompt, cfg);
    if (out) return out;
  }
  return explainLocalHttpError(statusCode, bodyText);
}
