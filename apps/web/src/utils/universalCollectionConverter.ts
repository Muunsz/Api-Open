import yaml from 'js-yaml';
import type { AuthConfig, BodyConfig, HttpMethod } from '@api-open/shared';
import type { ApiRequestDto } from '../api/workspace';
import type { CollectionTreeNode } from '../stores/workspace';
import { parseCurlCommand } from './curlParser';
import { generateCollectionDocsMarkdown } from './docsGenerator';
import { parseBruFile } from './gitSync';
import { parseHarExport, parseInsomniaExport } from './importConverters';
import { exportOpenApiSpec, parseOpenApiSpec } from './openApiConverter';
import {
  exportPostmanCollection,
  type ImportedCollectionNode,
  parsePostmanCollection,
} from './postmanConverter';
import { parseWsdlSpec } from './wsdlConverter';

export type CollectionExportFormat =
  | 'postman'
  | 'hoppscotch'
  | 'openapi-json'
  | 'openapi-yaml'
  | 'insomnia'
  | 'thunder'
  | 'bruno'
  | 'markdown';

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

function toMethod(raw?: string): HttpMethod {
  const upper = (raw || 'GET').toUpperCase() as HttpMethod;
  return VALID_METHODS.has(upper) ? upper : 'GET';
}

/* ==========================================================================
   Hoppscotch Importer & Exporter
   ========================================================================== */

interface HoppRequest {
  name?: string;
  method?: string;
  endpoint?: string;
  url?: string;
  params?: Array<{ key?: string; value?: string; active?: boolean }>;
  headers?: Array<{ key?: string; value?: string; active?: boolean }>;
  auth?: { authType?: string; authActive?: boolean; token?: string; username?: string; password?: string; key?: string; value?: string; addTo?: string };
  body?: { contentType?: string | null; body?: string | null };
}

interface HoppFolder {
  name?: string;
  folders?: HoppFolder[];
  requests?: HoppRequest[];
}

function parseHoppFolder(folder: HoppFolder): ImportedCollectionNode {
  const requests: Array<Omit<ApiRequestDto, 'id' | 'collectionId'>> = (
    folder.requests ?? []
  ).map((r) => {
    const auth: AuthConfig =
      r.auth?.authType === 'bearer'
        ? { type: 'bearer', token: r.auth.token ?? '' }
        : r.auth?.authType === 'basic'
          ? { type: 'basic', username: r.auth.username ?? '', password: r.auth.password ?? '' }
          : r.auth?.authType === 'api-key'
            ? {
                type: 'apikey',
                key: r.auth.key ?? '',
                value: r.auth.value ?? '',
                addTo: r.auth.addTo === 'query' ? 'query' : 'header',
              }
            : { type: 'none' };

    const rawBody = typeof r.body?.body === 'string' ? r.body.body : '';
    const body: BodyConfig = rawBody
      ? { mode: 'raw', raw: rawBody, rawType: 'json' }
      : { mode: 'none' };

    return {
      name: r.name || r.endpoint || r.url || 'Hoppscotch Request',
      method: toMethod(r.method),
      url: r.endpoint || r.url || '',
      headers: (r.headers ?? []).map((h) => ({
        id: uid(),
        key: h.key ?? '',
        value: h.value ?? '',
        enabled: h.active !== false,
      })),
      queryParams: (r.params ?? []).map((p) => ({
        id: uid(),
        key: p.key ?? '',
        value: p.value ?? '',
        enabled: p.active !== false,
      })),
      auth,
      body,
    };
  });

  return {
    name: folder.name || 'Hoppscotch Collection',
    folders: (folder.folders ?? []).map(parseHoppFolder),
    requests,
  };
}

export function parseHoppscotchCollection(jsonText: string): ImportedCollectionNode {
  const parsed = JSON.parse(jsonText) as HoppFolder | HoppFolder[];
  if (Array.isArray(parsed)) {
    return {
      name: 'Hoppscotch Collections',
      folders: parsed.map(parseHoppFolder),
      requests: [],
    };
  }
  return parseHoppFolder(parsed);
}

function toHoppFolder(node: CollectionTreeNode): Record<string, unknown> {
  const folders: Array<Record<string, unknown>> = [];
  const requests: Array<Record<string, unknown>> = [];

  for (const child of node.children ?? []) {
    if (child.kind === 'collection') {
      folders.push(toHoppFolder(child));
    } else if (child.kind === 'request' && child.request) {
      const r = child.request;
      requests.push({
        v: '11',
        name: r.name,
        method: r.method,
        endpoint: r.url,
        params: (r.queryParams ?? []).map((p) => ({
          key: p.key,
          value: p.value,
          active: p.enabled,
        })),
        headers: (r.headers ?? []).map((h) => ({
          key: h.key,
          value: h.value,
          active: h.enabled,
        })),
        auth:
          r.auth?.type === 'bearer'
            ? { authType: 'bearer', authActive: true, token: r.auth.token }
            : r.auth?.type === 'basic'
              ? { authType: 'basic', authActive: true, username: r.auth.username, password: r.auth.password }
              : { authType: 'none', authActive: true },
        body:
          r.body?.mode === 'raw'
            ? { contentType: 'application/json', body: r.body.raw ?? '' }
            : { contentType: null, body: null },
        preRequestScript: r.preRequestScript ?? '',
        testScript: r.testScript ?? '',
      });
    }
  }

  return {
    v: 2,
    name: node.label,
    folders,
    requests,
    auth: { authType: 'inherit', authActive: true },
    headers: [],
  };
}

export function exportHoppscotchCollection(node: CollectionTreeNode): string {
  return JSON.stringify(toHoppFolder(node), null, 2);
}

/* ==========================================================================
   Thunder Client Importer & Exporter
   ========================================================================== */

export function parseThunderClientCollection(jsonText: string): ImportedCollectionNode {
  const parsed = JSON.parse(jsonText) as {
    collectionName?: string;
    folders?: Array<{ _id: string; name: string; containerId?: string }>;
    requests?: Array<{
      _id?: string;
      containerId?: string;
      name?: string;
      url?: string;
      method?: string;
      headers?: Array<{ name?: string; value?: string; isDisabled?: boolean }>;
      params?: Array<{ name?: string; value?: string; isDisabled?: boolean }>;
      body?: { type?: string; raw?: string };
    }>;
  };

  const folderMap = new Map<string, ImportedCollectionNode>();
  for (const f of parsed.folders ?? []) {
    folderMap.set(f._id, { name: f.name || 'Folder', folders: [], requests: [] });
  }

  const rootRequests: Array<Omit<ApiRequestDto, 'id' | 'collectionId'>> = [];
  for (const r of parsed.requests ?? []) {
    const dto: Omit<ApiRequestDto, 'id' | 'collectionId'> = {
      name: r.name || r.url || 'Thunder Request',
      method: toMethod(r.method),
      url: r.url || '',
      headers: (r.headers ?? []).map((h) => ({
        id: uid(),
        key: h.name ?? '',
        value: h.value ?? '',
        enabled: !h.isDisabled,
      })),
      queryParams: (r.params ?? []).map((p) => ({
        id: uid(),
        key: p.name ?? '',
        value: p.value ?? '',
        enabled: !p.isDisabled,
      })),
      auth: { type: 'none' },
      body: r.body?.raw
        ? { mode: 'raw', raw: r.body.raw, rawType: 'json' }
        : { mode: 'none' },
    };
    if (r.containerId && folderMap.has(r.containerId)) {
      folderMap.get(r.containerId)!.requests.push(dto);
    } else {
      rootRequests.push(dto);
    }
  }

  const rootFolders: ImportedCollectionNode[] = [];
  for (const f of parsed.folders ?? []) {
    const node = folderMap.get(f._id)!;
    if (f.containerId && folderMap.has(f.containerId)) {
      folderMap.get(f.containerId)!.folders.push(node);
    } else {
      rootFolders.push(node);
    }
  }

  return {
    name: parsed.collectionName || 'Thunder Client Collection',
    folders: rootFolders,
    requests: rootRequests,
  };
}

export function exportThunderClientCollection(node: CollectionTreeNode): string {
  const colId = uid();
  const folders: Array<Record<string, unknown>> = [];
  const requests: Array<Record<string, unknown>> = [];

  const walk = (curr: CollectionTreeNode, containerId: string) => {
    for (const child of curr.children ?? []) {
      if (child.kind === 'collection') {
        const fId = uid();
        folders.push({ _id: fId, name: child.label, containerId });
        walk(child, fId);
      } else if (child.kind === 'request' && child.request) {
        const r = child.request;
        requests.push({
          _id: r.id,
          colId,
          containerId,
          name: r.name,
          url: r.url,
          method: r.method,
          headers: (r.headers ?? []).map((h) => ({
            name: h.key,
            value: h.value,
            isDisabled: !h.enabled,
          })),
          params: (r.queryParams ?? []).map((p) => ({
            name: p.key,
            value: p.value,
            isDisabled: !p.enabled,
          })),
          body:
            r.body?.mode === 'raw'
              ? { type: 'json', raw: r.body.raw ?? '' }
              : { type: 'none', raw: '' },
        });
      }
    }
  };
  walk(node, '');

  return JSON.stringify(
    {
      client: 'Thunder Client',
      collectionName: node.label,
      dateExported: new Date().toISOString(),
      version: '1.1',
      folders,
      requests,
    },
    null,
    2,
  );
}

/* ==========================================================================
   Bruno Importer & Exporter
   ========================================================================== */

interface BrunoItem {
  type?: string;
  name?: string;
  items?: BrunoItem[];
  request?: {
    method?: string;
    url?: string;
    headers?: Array<{ name?: string; value?: string; enabled?: boolean }>;
    params?: Array<{ name?: string; value?: string; enabled?: boolean; type?: string }>;
    body?: { mode?: string; json?: string; text?: string };
  };
}

function parseBrunoItem(item: BrunoItem): ImportedCollectionNode {
  const folders: ImportedCollectionNode[] = [];
  const requests: Array<Omit<ApiRequestDto, 'id' | 'collectionId'>> = [];

  for (const child of item.items ?? []) {
    if (child.type === 'folder' || Array.isArray(child.items)) {
      folders.push(parseBrunoItem(child));
    } else if (child.request) {
      const r = child.request;
      const raw = r.body?.json ?? r.body?.text ?? '';
      requests.push({
        name: child.name || r.url || 'Bruno Request',
        method: toMethod(r.method),
        url: r.url || '',
        headers: (r.headers ?? []).map((h) => ({
          id: uid(),
          key: h.name ?? '',
          value: h.value ?? '',
          enabled: h.enabled !== false,
        })),
        queryParams: (r.params ?? [])
          .filter((p) => !p.type || p.type === 'query')
          .map((p) => ({
            id: uid(),
            key: p.name ?? '',
            value: p.value ?? '',
            enabled: p.enabled !== false,
          })),
        auth: { type: 'none' },
        body: raw ? { mode: 'raw', raw, rawType: 'json' } : { mode: 'none' },
      });
    }
  }

  return {
    name: item.name || 'Bruno Collection',
    folders,
    requests,
  };
}

export function parseBrunoCollection(jsonText: string): ImportedCollectionNode {
  const parsed = JSON.parse(jsonText) as BrunoItem;
  return parseBrunoItem(parsed);
}

function toBrunoItems(node: CollectionTreeNode): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const child of node.children ?? []) {
    if (child.kind === 'collection') {
      out.push({
        type: 'folder',
        name: child.label,
        items: toBrunoItems(child),
      });
    } else if (child.kind === 'request' && child.request) {
      const r = child.request;
      out.push({
        type: 'http',
        name: r.name,
        request: {
          method: r.method,
          url: r.url,
          headers: (r.headers ?? []).map((h) => ({
            name: h.key,
            value: h.value,
            enabled: h.enabled,
          })),
          params: (r.queryParams ?? []).map((p) => ({
            name: p.key,
            value: p.value,
            enabled: p.enabled,
            type: 'query',
          })),
          body:
            r.body?.mode === 'raw'
              ? { mode: 'json', json: r.body.raw ?? '' }
              : { mode: 'none' },
        },
      });
    }
  }
  return out;
}

export function exportBrunoCollection(node: CollectionTreeNode): string {
  return JSON.stringify(
    {
      name: node.label,
      version: '1',
      type: 'collection',
      items: toBrunoItems(node),
    },
    null,
    2,
  );
}

/* ==========================================================================
   Insomnia v4 Exporter
   ========================================================================== */

export function exportInsomniaCollection(node: CollectionTreeNode): string {
  const wsId = `wrk_${uid()}`;
  const resources: Array<Record<string, unknown>> = [
    { _id: wsId, _type: 'workspace', name: node.label, scope: 'collection' },
  ];

  const walk = (curr: CollectionTreeNode, parentId: string) => {
    for (const child of curr.children ?? []) {
      if (child.kind === 'collection') {
        const fldId = `fld_${uid()}`;
        resources.push({ _id: fldId, _type: 'request_group', parentId, name: child.label });
        walk(child, fldId);
      } else if (child.kind === 'request' && child.request) {
        const r = child.request;
        resources.push({
          _id: `req_${r.id}`,
          _type: 'request',
          parentId,
          name: r.name,
          method: r.method,
          url: r.url,
          headers: (r.headers ?? []).map((h) => ({
            name: h.key,
            value: h.value,
            disabled: !h.enabled,
          })),
          parameters: (r.queryParams ?? []).map((p) => ({
            name: p.key,
            value: p.value,
            disabled: !p.enabled,
          })),
          body:
            r.body?.mode === 'raw'
              ? { mimeType: 'application/json', text: r.body.raw ?? '' }
              : {},
        });
      }
    }
  };
  walk(node, wsId);

  return JSON.stringify(
    {
      _type: 'export',
      __export_format: 4,
      __export_date: new Date().toISOString(),
      __export_source: 'api-open',
      resources,
    },
    null,
    2,
  );
}

/* ==========================================================================
   Universal Auto-Detect Importer & Dispatcher
   ========================================================================== */

export function parseUniversalCollection(
  rawText: string,
  fileName?: string,
): { node: ImportedCollectionNode; format: string } {
  const trimmed = rawText.trim();
  if (!trimmed) throw new Error('Imported file is empty');

  // 1. Bruno .bru file
  if (fileName?.toLowerCase().endsWith('.bru') || /^\s*meta\s*\{/i.test(trimmed)) {
    const req = parseBruFile(trimmed, fileName);
    return {
      format: 'Bruno (.bru)',
      node: {
        name: req.name,
        folders: [],
        requests: [req],
      },
    };
  }

  // 1.5 SOAP / WSDL (.wsdl / .xml)
  if (
    fileName?.toLowerCase().endsWith('.wsdl') ||
    /<(wsdl:)?definitions\b/i.test(trimmed)
  ) {
    return {
      format: 'SOAP / WSDL',
      node: parseWsdlSpec(trimmed),
    };
  }

  // 2. cURL command(s)
  if (/^\s*curl\s+/i.test(trimmed) || fileName?.toLowerCase().endsWith('.sh')) {
    const parsed = parseCurlCommand(trimmed);
    return {
      format: 'cURL',
      node: {
        name: fileName?.replace(/\.[^.]+$/, '') || 'cURL Import',
        folders: [],
        requests: [
          {
            name: parsed.url.replace(/^https?:\/\//, '').slice(0, 40) || 'cURL Request',
            method: parsed.method,
            url: parsed.url,
            headers: parsed.headers,
            queryParams: [],
            auth: parsed.auth,
            body: parsed.body,
          },
        ],
      },
    };
  }

  // 2. Try parsing JSON or YAML
  let obj: Record<string, unknown> | unknown[] | null = null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    obj = JSON.parse(trimmed) as Record<string, unknown> | unknown[];
  } else {
    const loaded = yaml.load(trimmed);
    if (loaded && typeof loaded === 'object') {
      obj = loaded as Record<string, unknown>;
    }
  }

  if (!obj || typeof obj !== 'object') {
    throw new Error('Unsupported collection format');
  }

  // 3. Array of Hoppscotch or Postman collections
  if (Array.isArray(obj)) {
    const first = obj[0] as Record<string, unknown> | undefined;
    if (first && ('requests' in first || 'folders' in first)) {
      return {
        format: 'Hoppscotch',
        node: parseHoppscotchCollection(JSON.stringify(obj)),
      };
    }
    return {
      format: 'Postman Bundle',
      node: {
        name: 'Imported Collections',
        folders: obj.map((c) => parsePostmanCollection(JSON.stringify(c))),
        requests: [],
      },
    };
  }

  // 4. Api-Open multi-collection bundle { collections: [...] }
  if (Array.isArray(obj.collections)) {
    return {
      format: 'Api-Open Bundle',
      node: {
        name: String(obj.workspace || 'Imported Bundle'),
        folders: (obj.collections as unknown[]).map((c) =>
          parsePostmanCollection(JSON.stringify(c)),
        ),
        requests: [],
      },
    };
  }

  // 5. OpenAPI / Swagger (JSON or YAML)
  if (obj.openapi || obj.swagger || obj.paths) {
    return {
      format: 'OpenAPI / Swagger',
      node: parseOpenApiSpec(trimmed),
    };
  }

  // 6. HAR (HTTP Archive)
  if (obj.log && typeof obj.log === 'object' && 'entries' in obj.log) {
    return {
      format: 'HAR',
      node: parseHarExport(JSON.stringify(obj)),
    };
  }

  // 7. Insomnia v4
  if (obj._type === 'export' || Array.isArray(obj.resources)) {
    return {
      format: 'Insomnia v4',
      node: parseInsomniaExport(JSON.stringify(obj)),
    };
  }

  // 8. Thunder Client
  if (obj.client === 'Thunder Client' || obj.collectionName) {
    return {
      format: 'Thunder Client',
      node: parseThunderClientCollection(JSON.stringify(obj)),
    };
  }

  // 9. Bruno
  if (obj.type === 'collection' && Array.isArray(obj.items)) {
    return {
      format: 'Bruno',
      node: parseBrunoCollection(JSON.stringify(obj)),
    };
  }

  // 10. Hoppscotch single collection
  if ('v' in obj && (Array.isArray(obj.requests) || Array.isArray(obj.folders))) {
    return {
      format: 'Hoppscotch',
      node: parseHoppscotchCollection(JSON.stringify(obj)),
    };
  }

  // 11. Postman v2.0 / v2.1
  if (obj.info || Array.isArray(obj.item)) {
    return {
      format: 'Postman',
      node: parsePostmanCollection(JSON.stringify(obj)),
    };
  }

  throw new Error(
    'Unrecognized format. Supported: Postman, Hoppscotch, OpenAPI/Swagger (JSON/YAML), Insomnia, Thunder Client, Bruno, HAR, cURL.',
  );
}

function maskTreeSecrets(node: CollectionTreeNode): CollectionTreeNode {
  return {
    ...node,
    children: (node.children ?? []).map((child) => {
      if (child.kind === 'collection') return maskTreeSecrets(child);
      if (child.kind === 'request' && child.request) {
        const r = child.request;
        let maskedAuth = r.auth;
        if (r.auth?.type === 'bearer') maskedAuth = { type: 'bearer', token: '{{SECRET_MASKED}}' };
        else if (r.auth?.type === 'basic') maskedAuth = { type: 'basic', username: r.auth.username, password: '{{SECRET_MASKED}}' };
        else if (r.auth?.type === 'apikey') maskedAuth = { ...r.auth, value: '{{SECRET_MASKED}}' };
        else if (r.auth?.type === 'oauth2') maskedAuth = { ...r.auth, accessToken: '{{SECRET_MASKED}}', clientSecret: '{{SECRET_MASKED}}' };
        else if (r.auth?.type === 'aws') maskedAuth = { ...r.auth, secretKey: '{{SECRET_MASKED}}' };
        else if (r.auth?.type === 'jwt') maskedAuth = { ...r.auth, secret: '{{SECRET_MASKED}}' };
        return {
          ...child,
          request: {
            ...r,
            auth: maskedAuth,
            headers: (r.headers ?? []).map((h) =>
              /auth|token|key|secret|cookie/i.test(h.key)
                ? { ...h, value: '{{SECRET_MASKED}}' }
                : h,
            ),
          },
        };
      }
      return child;
    }),
  };
}

export function serializeCollectionByFormat(
  rawNode: CollectionTreeNode,
  format: CollectionExportFormat,
  maskSecrets = false,
): { content: string; ext: string; mime: string } {
  const node = maskSecrets ? maskTreeSecrets(rawNode) : rawNode;
  switch (format) {
    case 'postman':
      return {
        content: exportPostmanCollection(node),
        ext: 'postman_collection.json',
        mime: 'application/json',
      };
    case 'hoppscotch':
      return {
        content: exportHoppscotchCollection(node),
        ext: 'hoppscotch.json',
        mime: 'application/json',
      };
    case 'openapi-json':
      return {
        content: exportOpenApiSpec(node, 'json'),
        ext: 'openapi.json',
        mime: 'application/json',
      };
    case 'openapi-yaml':
      return {
        content: exportOpenApiSpec(node, 'yaml'),
        ext: 'openapi.yaml',
        mime: 'application/yaml',
      };
    case 'insomnia':
      return {
        content: exportInsomniaCollection(node),
        ext: 'insomnia.json',
        mime: 'application/json',
      };
    case 'thunder':
      return {
        content: exportThunderClientCollection(node),
        ext: 'thunder_collection.json',
        mime: 'application/json',
      };
    case 'bruno':
      return {
        content: exportBrunoCollection(node),
        ext: 'bruno.json',
        mime: 'application/json',
      };
    case 'markdown':
      return {
        content: generateCollectionDocsMarkdown(node),
        ext: 'md',
        mime: 'text/markdown',
      };
  }
}
