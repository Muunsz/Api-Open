import type { CollectionTreeNode } from '../stores/workspace';
import { exportOpenApiSpec } from '../utils/openApiConverter';
import { exportPostmanCollection } from '../utils/postmanConverter';
import {
  type CollectionExportFormat,
  serializeCollectionByFormat,
} from '../utils/universalCollectionConverter';

export type { CollectionExportFormat };

export function downloadBlobFile(
  content: BlobPart,
  fileName: string,
  mimeType = 'text/plain',
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportSingleCollectionPostman(node: CollectionTreeNode) {
  const json = exportPostmanCollection(node);
  const safeName = node.label.replace(/[^a-zA-Z0-9_-]/g, '_');
  downloadBlobFile(json, `${safeName}.postman_collection.json`, 'application/json');
}

export function exportSingleCollectionOpenApi(
  node: CollectionTreeNode,
  format: 'json' | 'yaml' = 'json',
) {
  const content = exportOpenApiSpec(node, format);
  const safeName = node.label.replace(/[^a-zA-Z0-9_-]/g, '_');
  downloadBlobFile(
    content,
    `${safeName}.openapi.${format}`,
    format === 'yaml' ? 'application/yaml' : 'application/json',
  );
}

export function exportCollectionAsFormat(
  node: CollectionTreeNode,
  format: CollectionExportFormat,
  maskSecrets = true,
) {
  const { content, ext, mime } = serializeCollectionByFormat(
    node,
    format,
    maskSecrets,
  );
  const safeName = node.label.replace(/[^a-zA-Z0-9_-]/g, '_');
  downloadBlobFile(content, `${safeName}.${ext}`, mime);
}

export function exportAllCollectionsAsFormat(
  workspaceName: string,
  collectionTree: CollectionTreeNode[],
  format: CollectionExportFormat,
  maskSecrets = true,
) {
  if (!collectionTree.length) return;
  if (format === 'markdown') {
    const combined = collectionTree
      .map((n) => serializeCollectionByFormat(n, 'markdown', maskSecrets).content)
      .join('\n---\n\n');
    downloadBlobFile(
      combined,
      `${workspaceName.replace(/[^a-zA-Z0-9_-]/g, '_')}-docs.md`,
      'text/markdown',
    );
    return;
  }
  const mergedRoot: CollectionTreeNode = {
    id: 'workspace-bundle',
    label: workspaceName,
    kind: 'collection',
    children: collectionTree,
  };
  exportCollectionAsFormat(mergedRoot, format, maskSecrets);
}

export function exportAllCollectionsBundle(
  workspaceName: string,
  collectionTree: CollectionTreeNode[],
) {
  const bundle = {
    exportedAt: new Date().toISOString(),
    workspace: workspaceName,
    collections: collectionTree.map((node) =>
      JSON.parse(exportPostmanCollection(node)),
    ),
  };
  const datePart = new Date().toISOString().slice(0, 10);
  downloadBlobFile(
    JSON.stringify(bundle, null, 2),
    `api-open-collections-${datePart}.json`,
    'application/json',
  );
}

export function downloadWindowsLauncherScript(appUrl = window.location.origin) {
  const script = [
    '@echo off',
    `set "APP_URL=${appUrl}"`,
    'where msedge >nul 2>nul && (start "" msedge --app="%APP_URL%" & exit /b)',
    'where chrome >nul 2>nul && (start "" chrome --app="%APP_URL%" & exit /b)',
    'start "" "%APP_URL%"',
  ].join('\r\n');
  downloadBlobFile(script, 'Api-Open-Windows.bat', 'application/bat');
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function exportResponseToHar(params: {
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  statusCode: number;
  statusText: string;
  responseHeaders: Record<string, string>;
  responseBody: string;
  durationMs: number;
  timing?: {
    dnsMs: number;
    tcpMs: number;
    tlsMs: number;
    ttfbMs: number;
    downloadMs: number;
  };
}) {
  const har = {
    log: {
      version: '1.2',
      creator: { name: 'Api-Open', version: '1.0' },
      entries: [
        {
          startedDateTime: new Date().toISOString(),
          time: params.durationMs,
          request: {
            method: params.method,
            url: params.url,
            httpVersion: 'HTTP/1.1',
            headers: Object.entries(params.requestHeaders).map(([name, value]) => ({
              name,
              value,
            })),
            queryString: [],
            headersSize: -1,
            bodySize: -1,
          },
          response: {
            status: params.statusCode,
            statusText: params.statusText,
            httpVersion: 'HTTP/1.1',
            headers: Object.entries(params.responseHeaders).map(([name, value]) => ({
              name,
              value,
            })),
            content: {
              size: params.responseBody.length,
              mimeType: params.responseHeaders['content-type'] ?? 'text/plain',
              text: params.responseBody,
            },
            redirectURL: '',
            headersSize: -1,
            bodySize: params.responseBody.length,
          },
          cache: {},
          timings: {
            dns: params.timing?.dnsMs ?? -1,
            connect: params.timing?.tcpMs ?? -1,
            ssl: params.timing?.tlsMs ?? -1,
            send: 0,
            wait: params.timing?.ttfbMs ?? params.durationMs,
            receive: params.timing?.downloadMs ?? 0,
          },
        },
      ],
    },
  };
  downloadBlobFile(JSON.stringify(har, null, 2), 'network-waterfall.har', 'application/json');
}
