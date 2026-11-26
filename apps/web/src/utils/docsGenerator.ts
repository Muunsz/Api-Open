import type { CollectionTreeNode } from '../stores/workspace';

function renderNodeMarkdown(node: CollectionTreeNode, depth = 1): string {
  const heading = '#'.repeat(Math.min(depth, 4));
  const lines: string[] = [`${heading} ${node.label}`, ''];

  for (const child of node.children ?? []) {
    if (child.kind === 'collection') {
      lines.push(renderNodeMarkdown(child, depth + 1));
    } else if (child.kind === 'request' && child.request) {
      const req = child.request;
      lines.push(`${'#'.repeat(Math.min(depth + 1, 5))} \`${req.method}\` ${req.name}`);
      lines.push('');
      lines.push(`**URL:** \`${req.url}\``);
      lines.push('');

      const activePathParams = (req.pathParams ?? []).filter((p) => p.enabled && p.key);
      if (activePathParams.length) {
        lines.push('**Path Variables:**');
        lines.push('| Key | Value | Description |');
        lines.push('| --- | --- | --- |');
        for (const p of activePathParams) {
          lines.push(`| \`${p.key}\` | \`${p.value}\` | ${p.description ?? ''} |`);
        }
        lines.push('');
      }

      const activeParams = (req.queryParams ?? []).filter((q) => q.enabled && q.key);
      if (activeParams.length) {
        lines.push('**Query Parameters:**');
        lines.push('| Key | Value | Description |');
        lines.push('| --- | --- | --- |');
        for (const p of activeParams) {
          lines.push(`| \`${p.key}\` | \`${p.value}\` | ${p.description ?? ''} |`);
        }
        lines.push('');
      }

      const activeHeaders = (req.headers ?? []).filter((h) => h.enabled && h.key);
      if (activeHeaders.length) {
        lines.push('**Headers:**');
        lines.push('| Header | Value |');
        lines.push('| --- | --- |');
        for (const h of activeHeaders) {
          lines.push(`| \`${h.key}\` | \`${h.value}\` |`);
        }
        lines.push('');
      }

      if (req.body?.mode === 'raw' && req.body.raw) {
        lines.push('**Body:**');
        lines.push('```' + (req.body.rawType || 'json'));
        lines.push(req.body.raw);
        lines.push('```');
        lines.push('');
      }

      if (req.examples?.length) {
        lines.push('**Response Examples:**');
        for (const ex of req.examples) {
          lines.push(`- **${ex.name}** (\`${ex.statusCode} ${ex.statusText}\`)`);
          if (ex.body) {
            lines.push('```json');
            lines.push(ex.body);
            lines.push('```');
          }
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

export function generateCollectionDocsMarkdown(node: CollectionTreeNode): string {
  return renderNodeMarkdown(node, 1);
}
