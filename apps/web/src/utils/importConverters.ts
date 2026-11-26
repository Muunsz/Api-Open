import type { HttpMethod, KeyValueItem } from '@api-open/shared';
import type { ApiRequestDto } from '../api/workspace';
import type { ImportedCollectionNode } from './postmanConverter';

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

/**
 * Parses Insomnia v4 JSON export into Api-Open collection tree.
 */
export function parseInsomniaExport(jsonText: string): ImportedCollectionNode {
  const parsed = JSON.parse(jsonText) as {
    _type?: string;
    resources?: Array<{
      _id: string;
      _type: string;
      parentId?: string;
      name?: string;
      method?: string;
      url?: string;
      headers?: Array<{ name?: string; value?: string; disabled?: boolean }>;
      parameters?: Array<{ name?: string; value?: string; disabled?: boolean }>;
      body?: { mimeType?: string; text?: string };
    }>;
  };

  if (!Array.isArray(parsed.resources)) {
    throw new Error('Invalid Insomnia export JSON (missing resources)');
  }

  const workspace = parsed.resources.find((r) => r._type === 'workspace');
  const groups = parsed.resources.filter((r) => r._type === 'request_group');
  const requests = parsed.resources.filter((r) => r._type === 'request');

  const toDto = (
    r: (typeof requests)[number],
  ): Omit<ApiRequestDto, 'id' | 'collectionId'> => {
    const method = VALID_METHODS.has(
      (r.method?.toUpperCase() || 'GET') as HttpMethod,
    )
      ? ((r.method?.toUpperCase() || 'GET') as HttpMethod)
      : 'GET';
    const headers: KeyValueItem[] = (r.headers ?? []).map((h) => ({
      id: uid(),
      key: h.name ?? '',
      value: h.value ?? '',
      enabled: !h.disabled,
    }));
    const queryParams: KeyValueItem[] = (r.parameters ?? []).map((p) => ({
      id: uid(),
      key: p.name ?? '',
      value: p.value ?? '',
      enabled: !p.disabled,
    }));
    return {
      name: r.name || r.url || 'Insomnia Request',
      method,
      url: r.url || '',
      headers,
      queryParams,
      auth: { type: 'none' },
      body: r.body?.text
        ? { mode: 'raw', raw: r.body.text, rawType: 'json' }
        : { mode: 'none' },
    };
  };

  const folderMap = new Map<string, ImportedCollectionNode>();
  for (const g of groups) {
    folderMap.set(g._id, {
      name: g.name || 'Folder',
      folders: [],
      requests: [],
    });
  }

  const rootRequests: Array<Omit<ApiRequestDto, 'id' | 'collectionId'>> = [];
  for (const r of requests) {
    const dto = toDto(r);
    if (r.parentId && folderMap.has(r.parentId)) {
      folderMap.get(r.parentId)!.requests.push(dto);
    } else {
      rootRequests.push(dto);
    }
  }

  const rootFolders: ImportedCollectionNode[] = [];
  for (const g of groups) {
    const node = folderMap.get(g._id)!;
    if (g.parentId && folderMap.has(g.parentId)) {
      folderMap.get(g.parentId)!.folders.push(node);
    } else {
      rootFolders.push(node);
    }
  }

  return {
    name: workspace?.name || 'Insomnia Import',
    folders: rootFolders,
    requests: rootRequests,
  };
}

/**
 * Parses HTTP Archive (.har) JSON exported from browser DevTools into a Collection.
 */
export function parseHarExport(jsonText: string): ImportedCollectionNode {
  const parsed = JSON.parse(jsonText) as {
    log?: {
      entries?: Array<{
        request?: {
          method?: string;
          url?: string;
          headers?: Array<{ name?: string; value?: string }>;
          queryString?: Array<{ name?: string; value?: string }>;
          postData?: { mimeType?: string; text?: string };
        };
      }>;
    };
  };

  const entries = parsed.log?.entries;
  if (!Array.isArray(entries)) {
    throw new Error('Invalid HAR file (missing log.entries)');
  }

  const requests: Array<Omit<ApiRequestDto, 'id' | 'collectionId'>> = [];
  for (const entry of entries.slice(0, 100)) {
    const req = entry.request;
    if (!req?.url) continue;
    const rawMethod = (req.method || 'GET').toUpperCase() as HttpMethod;
    const method = VALID_METHODS.has(rawMethod) ? rawMethod : 'GET';
    const headers: KeyValueItem[] = (req.headers ?? [])
      .filter((h) => h.name && !h.name.startsWith(':'))
      .map((h) => ({
        id: uid(),
        key: h.name ?? '',
        value: h.value ?? '',
        enabled: true,
      }));
    const queryParams: KeyValueItem[] = (req.queryString ?? []).map((q) => ({
      id: uid(),
      key: q.name ?? '',
      value: q.value ?? '',
      enabled: true,
    }));

    let name = req.url;
    try {
      const u = new URL(req.url);
      name = `${method} ${u.pathname}`;
    } catch {
      // keep url
    }

    requests.push({
      name,
      method,
      url: req.url,
      headers,
      queryParams,
      auth: { type: 'none' },
      body: req.postData?.text
        ? { mode: 'raw', raw: req.postData.text, rawType: 'json' }
        : { mode: 'none' },
    });
  }

  return {
    name: `HAR Import (${new Date().toLocaleDateString()})`,
    folders: [],
    requests,
  };
}
