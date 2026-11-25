import type { HttpMethod, KeyValueItem } from '@api-open/shared';
import type { ApiRequestDto } from '../api/workspace';
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

export function parseOpenApiSpec(jsonText: string): ImportedCollectionNode {
  const doc = JSON.parse(jsonText) as OpenApiDoc;
  if (!doc || !doc.paths) {
    throw new Error('Invalid OpenAPI / Swagger JSON (missing "paths")');
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
        else if (param.in === 'header') headers.push(row);
      }

      const rawJson = buildExampleBody(op);
      const reqItem: Omit<ApiRequestDto, 'id' | 'collectionId'> = {
        name: op.summary || op.operationId || `${method} ${pathKey}`,
        method,
        url: `${baseUrl}${pathKey.startsWith('/') ? pathKey : `/${pathKey}`}`,
        headers,
        queryParams,
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
