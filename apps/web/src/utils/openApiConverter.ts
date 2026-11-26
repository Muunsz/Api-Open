import yaml from 'js-yaml';
import type { HttpMethod, KeyValueItem } from '@api-open/shared';
import type { ApiRequestDto } from '../api/workspace';
import type { CollectionTreeNode } from '../stores/workspace';
import type { ImportedCollectionNode } from './postmanConverter';

interface OpenApiParam {
  name?: string;
  in?: string;
  example?: unknown;
}

interface OpenApiOperation {
  summary?: string;
  operationId?: string;
  tags?: string[];
  parameters?: OpenApiParam[];
  requestBody?: {
    content?: Record<
      string,
      {
        example?: unknown;
        schema?: { properties?: Record<string, { example?: unknown; type?: string }> };
      }
    >;
  };
}

interface OpenApiDoc {
  openapi?: string;
  swagger?: string;
  info?: { title?: string };
  servers?: Array<{ url?: string }>;
  host?: string;
  basePath?: string;
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
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

function buildExampleBody(op: OpenApiOperation): string {
  const jsonContent = op.requestBody?.content?.['application/json'];
  if (!jsonContent) return '';
  if (jsonContent.example !== undefined) {
    return JSON.stringify(jsonContent.example, null, 2);
  }
  const props = jsonContent.schema?.properties;
  if (props) {
    const obj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(props)) {
      obj[key] =
        val.example !== undefined
          ? val.example
          : val.type === 'number' || val.type === 'integer'
            ? 0
            : val.type === 'boolean'
              ? false
              : '';
    }
    return JSON.stringify(obj, null, 2);
  }
  return '{\n  \n}';
}

export function parseOpenApiDocumentText(rawText: string): OpenApiDoc {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('OpenAPI specification is empty');
  }
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as OpenApiDoc;
  }
  return yaml.load(trimmed) as OpenApiDoc;
}

export function parseOpenApiSpec(specText: string): ImportedCollectionNode {
  const doc = parseOpenApiDocumentText(specText);
  if (!doc || !doc.paths) {
    throw new Error('Invalid OpenAPI / Swagger spec (missing "paths")');
  }

  let baseUrl = '{{base_url}}';
  if (doc.servers?.[0]?.url) {
    baseUrl = doc.servers[0].url.replace(/\/$/, '');
  } else if (doc.host) {
    baseUrl = `https://${doc.host}${doc.basePath ?? ''}`.replace(/\/$/, '');
  }

  const tagMap = new Map<string, Array<Omit<ApiRequestDto, 'id' | 'collectionId'>>>();
  const rootRequests: Array<Omit<ApiRequestDto, 'id' | 'collectionId'>> = [];

  for (const [pathKey, methodsObj] of Object.entries(doc.paths)) {
    for (const [rawMethod, op] of Object.entries(methodsObj)) {
      const method = rawMethod.toUpperCase() as HttpMethod;
      if (!VALID_METHODS.has(method) || !op || typeof op !== 'object') continue;

      const queryParams: KeyValueItem[] = [];
      const pathParams: KeyValueItem[] = [];
      const headers: KeyValueItem[] = [];

      for (const param of op.parameters ?? []) {
        if (!param.name) continue;
        const row: KeyValueItem = {
          id: uid(),
          key: param.name,
          value: param.example !== undefined ? String(param.example) : '',
          enabled: true,
        };
        if (param.in === 'query') queryParams.push(row);
        else if (param.in === 'path') pathParams.push(row);
        else if (param.in === 'header') headers.push(row);
      }

      const rawJson = buildExampleBody(op);
      const reqItem: Omit<ApiRequestDto, 'id' | 'collectionId'> = {
        name: op.summary || op.operationId || `${method} ${pathKey}`,
        method,
        url: `${baseUrl}${pathKey.startsWith('/') ? pathKey : `/${pathKey}`}`,
        headers,
        queryParams,
        pathParams,
        auth: { type: 'none' },
        body: rawJson
          ? { mode: 'raw', raw: rawJson, rawType: 'json' }
          : { mode: 'none' },
      };

      const tag = op.tags?.[0];
      if (tag) {
        if (!tagMap.has(tag)) tagMap.set(tag, []);
        tagMap.get(tag)!.push(reqItem);
      } else {
        rootRequests.push(reqItem);
      }
    }
  }

  const folders: ImportedCollectionNode[] = Array.from(tagMap.entries()).map(
    ([name, requests]) => ({
      name,
      folders: [],
      requests,
    }),
  );

  return {
    name: doc.info?.title || 'OpenAPI Collection',
    folders,
    requests: rootRequests,
  };
}

function collectRequestsWithTag(
  node: CollectionTreeNode,
  tag?: string,
): Array<{ req: ApiRequestDto; tag: string }> {
  const out: Array<{ req: ApiRequestDto; tag: string }> = [];
  for (const child of node.children ?? []) {
    if (child.kind === 'request' && child.request) {
      out.push({ req: child.request, tag: tag || node.label });
    } else if (child.kind === 'collection') {
      out.push(...collectRequestsWithTag(child, child.label));
    }
  }
  return out;
}

function normalizeOpenApiPath(rawUrl: string): {
  serverUrl: string;
  path: string;
} {
  const cleaned = rawUrl.split('?')[0].split('#')[0].trim();
  const match = cleaned.match(/^(https?:\/\/[^/]+|\{\{[^}]+\}\})(.*)$/i);
  const serverUrl = match ? match[1] : '{{base_url}}';
  let path = match ? match[2] || '/' : cleaned || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '/{$1}');
  return { serverUrl, path };
}

export function generateOpenApiDocument(
  node: CollectionTreeNode,
): Record<string, unknown> {
  const entries = collectRequestsWithTag(node);
  const serversSet = new Set<string>();
  const paths: Record<string, Record<string, unknown>> = {};

  for (const { req, tag } of entries) {
    const { serverUrl, path } = normalizeOpenApiPath(req.url);
    if (serverUrl) serversSet.add(serverUrl);

    const parameters: Array<Record<string, unknown>> = [];
    for (const p of req.pathParams ?? []) {
      if (!p.key.trim()) continue;
      parameters.push({
        name: p.key.trim(),
        in: 'path',
        required: true,
        schema: { type: 'string' },
        ...(p.value ? { example: p.value } : {}),
        ...(p.description ? { description: p.description } : {}),
      });
    }
    for (const q of req.queryParams ?? []) {
      if (!q.enabled || !q.key.trim()) continue;
      parameters.push({
        name: q.key.trim(),
        in: 'query',
        required: false,
        schema: { type: 'string' },
        ...(q.value ? { example: q.value } : {}),
        ...(q.description ? { description: q.description } : {}),
      });
    }
    for (const h of req.headers ?? []) {
      if (!h.enabled || !h.key.trim()) continue;
      parameters.push({
        name: h.key.trim(),
        in: 'header',
        required: false,
        schema: { type: 'string' },
        ...(h.value ? { example: h.value } : {}),
      });
    }

    let requestBody: Record<string, unknown> | undefined;
    if (req.body?.mode === 'raw' && req.body.raw) {
      let parsedExample: unknown = req.body.raw;
      try {
        parsedExample = JSON.parse(req.body.raw);
      } catch {
        // keep string
      }
      const mime =
        req.body.rawType === 'xml'
          ? 'application/xml'
          : req.body.rawType === 'html'
            ? 'text/html'
            : req.body.rawType === 'text'
              ? 'text/plain'
              : 'application/json';
      requestBody = {
        content: {
          [mime]: {
            schema: { type: typeof parsedExample === 'object' ? 'object' : 'string' },
            example: parsedExample,
          },
        },
      };
    }

    const responses: Record<string, unknown> = {};
    if (req.examples?.length) {
      for (const ex of req.examples) {
        let parsedBody: unknown = ex.body;
        try {
          parsedBody = JSON.parse(ex.body);
        } catch {
          // keep string
        }
        responses[String(ex.statusCode || 200)] = {
          description: ex.name || ex.statusText || 'Response',
          content: {
            'application/json': {
              example: parsedBody,
            },
          },
        };
      }
    } else {
      responses['200'] = { description: 'Successful response' };
    }

    const methodKey = req.method.toLowerCase();
    if (!paths[path]) paths[path] = {};
    paths[path][methodKey] = {
      summary: req.name,
      tags: [tag],
      ...(parameters.length ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      responses,
    };
  }

  return {
    openapi: '3.0.3',
    info: {
      title: node.label,
      version: '1.0.0',
    },
    servers: Array.from(serversSet).map((url) => ({ url })),
    paths,
  };
}

function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') {
    if (value.includes('\n')) {
      return `|\n${value
        .split('\n')
        .map((line) => `${pad}  ${line}`)
        .join('\n')}`;
    }
    if (
      value === '' ||
      /[:#{}[\],&*!|>'"%@`\s]|^(true|false|null|\d+)$/i.test(value)
    ) {
      return JSON.stringify(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return value
      .map((item) => {
        if (item && typeof item === 'object') {
          const rendered = toYaml(item, indent + 1);
          const firstTrimmed = rendered.replace(/^\s+/, '');
          return `${pad}- ${firstTrimmed}`;
        }
        return `${pad}- ${toYaml(item, indent + 1)}`;
      })
      .join('\n');
  }
  const obj = value as Record<string, unknown>;
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  if (!entries.length) return '{}';
  return entries
    .map(([k, v]) => {
      const safeKey = /^[a-zA-Z0-9_.-]+$/.test(k) ? k : JSON.stringify(k);
      if (v && typeof v === 'object' && (!Array.isArray(v) || v.length > 0)) {
        const isEmptyObj = !Array.isArray(v) && Object.keys(v).length === 0;
        if (isEmptyObj) return `${pad}${safeKey}: {}`;
        return `${pad}${safeKey}:\n${toYaml(v, indent + 1)}`;
      }
      return `${pad}${safeKey}: ${toYaml(v, indent + 1)}`;
    })
    .join('\n');
}

export function exportOpenApiSpec(
  node: CollectionTreeNode,
  format: 'json' | 'yaml' = 'json',
): string {
  const doc = generateOpenApiDocument(node);
  if (format === 'yaml') {
    return `${toYaml(doc)}\n`;
  }
  return JSON.stringify(doc, null, 2);
}

export function validateContractAgainstSpec(
  specDoc: Record<string, unknown>,
  method: string,
  targetUrl: string,
  statusCode: number,
  responseBody: string,
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const paths = specDoc.paths as Record<string, Record<string, Record<string, unknown>>> | undefined;
  if (!paths) return { valid: false, issues: ['Spec has no "paths" object'] };

  const { path: normalizedActual } = normalizeOpenApiPath(targetUrl);
  const actualSegs = normalizedActual.split('/').filter(Boolean);

  let matchedOp: Record<string, unknown> | undefined;
  for (const [specPath, methodsObj] of Object.entries(paths)) {
    const specSegs = specPath.split('/').filter(Boolean);
    if (specSegs.length !== actualSegs.length) continue;
    const isMatch = specSegs.every((s, idx) =>
      (s.startsWith('{') && s.endsWith('}')) || s === actualSegs[idx],
    );
    if (isMatch && methodsObj[method.toLowerCase()]) {
      matchedOp = methodsObj[method.toLowerCase()];
      break;
    }
  }

  if (!matchedOp) {
    issues.push(`No matching ${method.toUpperCase()} operation found for path "${normalizedActual}"`);
    return { valid: false, issues };
  }

  const responses = matchedOp.responses as Record<string, Record<string, unknown>> | undefined;
  const statusSpec = responses?.[String(statusCode)] ?? responses?.default;
  if (!statusSpec) {
    issues.push(`Status code ${statusCode} is not documented in OpenAPI responses`);
  } else {
    const content = statusSpec.content as Record<string, { schema?: { required?: string[]; properties?: Record<string, { type?: string }> } }> | undefined;
    const jsonSchema = content?.['application/json']?.schema;
    if (jsonSchema && responseBody) {
      try {
        const parsed = JSON.parse(responseBody) as Record<string, unknown>;
        if (Array.isArray(jsonSchema.required) && parsed && typeof parsed === 'object') {
          for (const reqField of jsonSchema.required) {
            if (!(reqField in parsed)) {
              issues.push(`Missing required response field: "${reqField}"`);
            }
          }
        }
        if (jsonSchema.properties && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [k, propSchema] of Object.entries(jsonSchema.properties)) {
            if (k in parsed && propSchema?.type) {
              const actualType = Array.isArray(parsed[k]) ? 'array' : typeof parsed[k];
              const expected = propSchema.type === 'integer' ? 'number' : propSchema.type;
              if (parsed[k] !== null && actualType !== expected) {
                issues.push(`Field "${k}" expected ${propSchema.type}, got ${actualType}`);
              }
            }
          }
        }
      } catch {
        issues.push('Response body is not valid JSON as expected by application/json schema');
      }
    }
  }

  return { valid: issues.length === 0, issues };
}
