import type {
  AuthConfig,
  BodyConfig,
  HttpMethod,
  KeyValueItem,
} from '@api-open/shared';
import type { ApiRequestDto } from '../api/workspace';
import type { CollectionTreeNode } from '../stores/workspace';

interface PostmanKv {
  key?: string;
  value?: string;
  disabled?: boolean;
}

interface PostmanItem {
  name?: string;
  item?: PostmanItem[];
  request?: {
    method?: string;
    url?: string | { raw?: string; query?: PostmanKv[] };
    header?: PostmanKv[];
    auth?: {
      type?: string;
      bearer?: PostmanKv[];
      basic?: PostmanKv[];
      apikey?: PostmanKv[];
    };
    body?: {
      mode?: string;
      raw?: string;
      options?: { raw?: { language?: string } };
      urlencoded?: PostmanKv[];
      graphql?: { query?: string; variables?: string };
    };
  };
  event?: Array<{
    listen?: string;
    script?: { exec?: string[] | string };
  }>;
}

export interface ImportedCollectionNode {
  name: string;
  folders: ImportedCollectionNode[];
  requests: Array<Omit<ApiRequestDto, 'id' | 'collectionId'>>;
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

function mapKvList(list?: PostmanKv[]): KeyValueItem[] {
  if (!Array.isArray(list)) return [];
  return list.map((row) => ({
    id: uid(),
    key: row.key ?? '',
    value: row.value ?? '',
    enabled: !row.disabled,
  }));
}

function parseAuth(auth?: NonNullable<PostmanItem['request']>['auth']): AuthConfig {
  if (!auth || !auth.type || auth.type === 'noauth') return { type: 'none' };

  const getVal = (arr: PostmanKv[] | undefined, key: string) =>
    arr?.find((x) => x.key === key)?.value ?? '';

  if (auth.type === 'bearer') {
    return { type: 'bearer', token: getVal(auth.bearer, 'token') };
  }
  if (auth.type === 'basic') {
    return {
      type: 'basic',
      username: getVal(auth.basic, 'username'),
      password: getVal(auth.basic, 'password'),
    };
  }
  if (auth.type === 'apikey') {
    return {
      type: 'apikey',
      key: getVal(auth.apikey, 'key'),
      value: getVal(auth.apikey, 'value'),
      addTo: getVal(auth.apikey, 'in') === 'query' ? 'query' : 'header',
    };
  }
  return { type: 'none' };
}

function parseBody(body?: NonNullable<PostmanItem['request']>['body']): BodyConfig {
  if (!body || !body.mode) return { mode: 'none' };
  if (body.mode === 'raw') {
    const lang = body.options?.raw?.language;
    const rawType =
      lang === 'json' || lang === 'xml' || lang === 'html' ? lang : 'text';
    return { mode: 'raw', raw: body.raw ?? '', rawType };
  }
  if (body.mode === 'urlencoded') {
    return { mode: 'urlencoded', urlencoded: mapKvList(body.urlencoded) };
  }
  if (body.mode === 'graphql') {
    return {
      mode: 'graphql',
      graphql: {
        query: body.graphql?.query ?? '',
        variables: body.graphql?.variables ?? '{}',
      },
    };
  }
  return { mode: 'none' };
}

function extractScript(
  events: PostmanItem['event'],
  listen: 'prerequest' | 'test',
): string {
  const ev = events?.find((e) => e.listen === listen);
  if (!ev?.script?.exec) return '';
  return Array.isArray(ev.script.exec)
    ? ev.script.exec.join('\n')
    : ev.script.exec;
}

function parseItems(items: PostmanItem[]): {
  folders: ImportedCollectionNode[];
  requests: Array<Omit<ApiRequestDto, 'id' | 'collectionId'>>;
} {
  const folders: ImportedCollectionNode[] = [];
  const requests: Array<Omit<ApiRequestDto, 'id' | 'collectionId'>> = [];

  for (const item of items) {
    if (Array.isArray(item.item)) {
      const nested = parseItems(item.item);
      folders.push({
        name: item.name || 'Folder',
        folders: nested.folders,
        requests: nested.requests,
      });
    } else if (item.request) {
      const rawMethod = (item.request.method || 'GET').toUpperCase() as HttpMethod;
      const method = VALID_METHODS.has(rawMethod) ? rawMethod : 'GET';
      const urlObj = item.request.url;
      const url = typeof urlObj === 'string' ? urlObj : urlObj?.raw ?? '';
      const queryParams =
        typeof urlObj === 'object' && urlObj?.query
          ? mapKvList(urlObj.query)
          : [];

      requests.push({
        name: item.name || url || 'Untitled Request',
        method,
        url,
        headers: mapKvList(item.request.header),
        queryParams,
        auth: parseAuth(item.request.auth),
        body: parseBody(item.request.body),
        preRequestScript: extractScript(item.event, 'prerequest'),
        testScript: extractScript(item.event, 'test'),
      });
    }
  }

  return { folders, requests };
}

export function parsePostmanCollection(jsonText: string): ImportedCollectionNode {
  const data = JSON.parse(jsonText) as {
    info?: { name?: string };
    item?: PostmanItem[];
  };
  if (!data || !Array.isArray(data.item)) {
    throw new Error('Invalid Postman Collection v2.1 JSON');
  }
  const parsed = parseItems(data.item);
  return {
    name: data.info?.name || 'Imported Collection',
    folders: parsed.folders,
    requests: parsed.requests,
  };
}

function exportTreeNodeItems(node: CollectionTreeNode): PostmanItem[] {
  const items: PostmanItem[] = [];
  for (const child of node.children ?? []) {
    if (child.kind === 'collection') {
      items.push({
        name: child.label,
        item: exportTreeNodeItems(child),
      });
    } else if (child.kind === 'request' && child.request) {
      const req = child.request;
      const events: PostmanItem['event'] = [];
      if (req.preRequestScript?.trim()) {
        events.push({
          listen: 'prerequest',
          script: { exec: req.preRequestScript.split('\n') },
        });
      }
      if (req.testScript?.trim()) {
        events.push({
          listen: 'test',
          script: { exec: req.testScript.split('\n') },
        });
      }

      items.push({
        name: req.name,
        request: {
          method: req.method,
          url: {
            raw: req.url,
            query: (req.queryParams ?? [])
              .filter((q) => q.key)
              .map((q) => ({ key: q.key, value: q.value, disabled: !q.enabled })),
          },
          header: (req.headers ?? [])
            .filter((h) => h.key)
            .map((h) => ({ key: h.key, value: h.value, disabled: !h.enabled })),
          body:
            req.body?.mode === 'raw'
              ? {
                  mode: 'raw',
                  raw: req.body.raw ?? '',
                  options: { raw: { language: req.body.rawType ?? 'text' } },
                }
              : req.body?.mode === 'urlencoded'
                ? {
                    mode: 'urlencoded',
                    urlencoded: (req.body.urlencoded ?? []).map((u) => ({
                      key: u.key,
                      value: u.value,
                      disabled: !u.enabled,
                    })),
                  }
                : undefined,
        },
        ...(events.length ? { event: events } : {}),
      });
    }
  }
  return items;
}

export function exportPostmanCollection(node: CollectionTreeNode): string {
  return JSON.stringify(
    {
      info: {
        name: node.label,
        schema:
          'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: exportTreeNodeItems(node),
    },
    null,
    2,
  );
}
