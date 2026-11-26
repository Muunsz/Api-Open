import type { HttpMethod, KeyValueItem } from '@api-open/shared';
import type { ApiRequestDto } from '../api/workspace';
import type { CollectionTreeNode } from '../stores/workspace';
import type { EnvironmentDto } from '../types/workspace';
import {
  type CollectionExportFormat,
  serializeCollectionByFormat,
} from './universalCollectionConverter';

interface FsDirectoryHandle {
  name: string;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsDirectoryHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{
    createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  }>;
  values(): AsyncIterable<{
    kind: 'file' | 'directory';
    name: string;
    getFile?: () => Promise<File>;
  }>;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Parses a Bruno (.bru) text file into an ApiRequestDto.
 */
export function parseBruFile(
  bruText: string,
  fileName = 'Request.bru',
): Omit<ApiRequestDto, 'id' | 'collectionId'> {
  const nameMatch = bruText.match(/meta\s*\{[^}]*name:\s*(.+)/i);
  const name = nameMatch?.[1]?.trim() || fileName.replace(/\.bru$/i, '');

  const methodBlockMatch = bruText.match(
    /\b(get|post|put|patch|delete|head|options)\s*\{([\s\S]*?)\}/i,
  );
  const method = (
    methodBlockMatch?.[1]?.toUpperCase() || 'GET'
  ) as HttpMethod;
  const urlMatch = methodBlockMatch?.[2]?.match(/url:\s*(.+)/i);
  const url = urlMatch?.[1]?.trim() || '';

  const headers: KeyValueItem[] = [];
  const headersMatch = bruText.match(/headers\s*\{([\s\S]*?)\}/i);
  if (headersMatch) {
    for (const line of headersMatch[1].split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const enabled = !trimmed.startsWith('~');
      const clean = enabled ? trimmed : trimmed.slice(1);
      const idx = clean.indexOf(':');
      if (idx > 0) {
        headers.push({
          id: uid(),
          key: clean.slice(0, idx).trim(),
          value: clean.slice(idx + 1).trim(),
          enabled,
        });
      }
    }
  }

  const bodyMatch = bruText.match(/body:json\s*\{([\s\S]*?)\n\}/i);
  const rawBody = bodyMatch?.[1]?.trim() || '';

  return {
    name,
    method,
    url,
    headers,
    queryParams: [],
    auth: { type: 'none' },
    body: rawBody ? { mode: 'raw', raw: rawBody, rawType: 'json' } : { mode: 'none' },
  };
}

/**
 * Serializes an ApiRequestDto into a Bruno (.bru) file.
 */
export function serializeBruFile(req: ApiRequestDto): string {
  const lines: string[] = [
    'meta {',
    `  name: ${req.name}`,
    '  type: http',
    '}',
    '',
    `${req.method.toLowerCase()} {`,
    `  url: ${req.url}`,
    `  body: ${req.body?.mode === 'raw' ? 'json' : 'none'}`,
    '}',
  ];

  if (req.headers?.some((h) => h.key.trim())) {
    lines.push('', 'headers {');
    for (const h of req.headers) {
      if (!h.key.trim()) continue;
      lines.push(`  ${h.enabled ? '' : '~'}${h.key}: ${h.value}`);
    }
    lines.push('}');
  }

  if (req.body?.mode === 'raw' && req.body.raw) {
    lines.push('', 'body:json {', req.body.raw, '}');
  }

  return `${lines.join('\n')}\n`;
}

export async function syncWorkspaceToLocalFolder(
  collectionTree: CollectionTreeNode[],
  environments: EnvironmentDto[],
  format: CollectionExportFormat | 'bru-tree' = 'postman',
  maskSecrets = true,
): Promise<{ folderName: string; filesWritten: number }> {
  const picker = (
    window as unknown as { showDirectoryPicker?: () => Promise<FsDirectoryHandle> }
  ).showDirectoryPicker;
  if (!picker) {
    throw new Error(
      'File System Access API is only supported in Chromium browsers (Chrome / Edge).',
    );
  }

  const rootDir = await picker();
  const colsDir = await rootDir.getDirectoryHandle('collections', { create: true });
  const envsDir = await rootDir.getDirectoryHandle('environments', { create: true });

  let filesWritten = 0;

  const writeFile = async (dir: FsDirectoryHandle, name: string, content: string) => {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
    filesWritten++;
  };

  if (format === 'bru-tree') {
    const writeBruTree = async (dir: FsDirectoryHandle, node: CollectionTreeNode) => {
      const safeDir = node.label.replace(/[^a-zA-Z0-9_-]/g, '_') || 'folder';
      const subDir = await dir.getDirectoryHandle(safeDir, { create: true });
      for (const child of node.children ?? []) {
        if (child.kind === 'collection') {
          await writeBruTree(subDir, child);
        } else if (child.kind === 'request' && child.request) {
          const safeFile = child.request.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'request';
          await writeFile(subDir, `${safeFile}.bru`, serializeBruFile(child.request));
        }
      }
    };
    for (const col of collectionTree) {
      await writeBruTree(colsDir, col);
    }
  } else {
    for (const col of collectionTree) {
      const safe = col.label.replace(/[^a-zA-Z0-9_-]/g, '_');
      const { content, ext } = serializeCollectionByFormat(col, format, maskSecrets);
      await writeFile(colsDir, `${safe}.${ext}`, content);
    }
  }

  for (const env of environments) {
    const safe = env.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitized = {
      name: env.name,
      values: env.variables.map((v) => ({
        key: v.key,
        value: maskSecrets && v.isSecret ? '{{SECRET_MASKED}}' : v.value,
        type: v.isSecret ? 'secret' : 'default',
        enabled: v.enabled,
      })),
    };
    await writeFile(
      envsDir,
      `${safe}.postman_environment.json`,
      JSON.stringify(sanitized, null, 2),
    );
  }

  await writeFile(rootDir, '.gitignore', '*.secret.env\n.local-vault.json\n');

  return { folderName: rootDir.name, filesWritten };
}

export async function readCollectionsFromLocalFolder(): Promise<
  Array<{ path: string; name: string; content: string }>
> {
  const picker = (
    window as unknown as { showDirectoryPicker?: () => Promise<FsDirectoryHandle> }
  ).showDirectoryPicker;
  if (!picker) {
    throw new Error(
      'File System Access API is only supported in Chromium browsers (Chrome / Edge).',
    );
  }
  const rootDir = await picker();
  const files: Array<{ path: string; name: string; content: string }> = [];

  const scan = async (dir: FsDirectoryHandle, prefix = '') => {
    for await (const entry of dir.values()) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const sub = await dir.getDirectoryHandle(entry.name);
        await scan(sub, relPath);
      } else if (
        entry.kind === 'file' &&
        entry.getFile &&
        /\.(json|yaml|yml|bru|har)$/i.test(entry.name) &&
        entry.name !== 'package.json' &&
        entry.name !== 'tsconfig.json'
      ) {
        const f = await entry.getFile();
        files.push({ path: relPath, name: f.name, content: await f.text() });
      }
    }
  };

  await scan(rootDir);
  return files;
}

export async function readCollectionsFromFileList(
  fileList: FileList,
): Promise<Array<{ path: string; name: string; content: string }>> {
  const files: Array<{ path: string; name: string; content: string }> = [];
  for (const f of Array.from(fileList)) {
    const rel = f.webkitRelativePath || f.name;
    if (
      rel.includes('node_modules/') ||
      rel.includes('.git/') ||
      !/\.(json|yaml|yml|bru|har)$/i.test(f.name) ||
      f.name === 'package.json' ||
      f.name === 'tsconfig.json'
    ) {
      continue;
    }
    files.push({ path: rel, name: f.name, content: await f.text() });
  }
  return files;
}
