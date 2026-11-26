import { All, Controller, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ResponseExample } from '@api-open/shared';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('mock')
export class MockController {
  constructor(private readonly prisma: PrismaService) {}

  @All(':collectionId')
  handleRoot(
    @Param('collectionId') collectionId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.handleMock(collectionId, '/', req, res);
  }

  @All(':collectionId/*path')
  handleWildcard(
    @Param('collectionId') collectionId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const prefix = `/mock/${collectionId}`;
    const rawPath = req.path.startsWith(prefix)
      ? req.path.slice(prefix.length) || '/'
      : '/';
    return this.handleMock(collectionId, rawPath, req, res);
  }

  private normalizePath(rawUrl: string): string {
    const cleaned = rawUrl.split('?')[0].split('#')[0].trim();
    const afterHost = cleaned.replace(/^(https?:\/\/[^/]+|\{\{[^}]+\}\})/i, '');
    if (!afterHost) return '/';
    return afterHost.startsWith('/') ? afterHost : `/${afterHost}`;
  }

  private pathMatches(template: string, actual: string): boolean {
    const tParts = template.split('/').filter(Boolean);
    const aParts = actual.split('/').filter(Boolean);
    if (tParts.length !== aParts.length) return false;
    return tParts.every((seg, idx) => {
      if (seg.startsWith(':') || (seg.startsWith('{') && seg.endsWith('}'))) {
        return Boolean(aParts[idx]);
      }
      return seg === aParts[idx];
    });
  }

  private interpolateFaker(raw: string): string {
    if (!raw || !raw.includes('{{$')) return raw;
    const names = ['Alya Pratama', 'Budi Santoso', 'Citra Dewi', 'Dimas Wijaya'];
    return raw
      .replace(/\{\{\$guid\}\}/g, () => crypto.randomUUID())
      .replace(/\{\{\$timestamp\}\}/g, () => String(Math.floor(Date.now() / 1000)))
      .replace(/\{\{\$isoTimestamp\}\}/g, () => new Date().toISOString())
      .replace(/\{\{\$randomInt\}\}/g, () => String(Math.floor(Math.random() * 1000)))
      .replace(/\{\{\$randomName\}\}/g, () => names[Math.floor(Math.random() * names.length)])
      .replace(
        /\{\{\$randomEmail\}\}/g,
        () => `user${Math.floor(Math.random() * 9000 + 1000)}@example.com`,
      );
  }

  private async handleMock(
    collectionId: string,
    incomingPath: string,
    req: Request,
    res: Response,
  ) {
    const allCols = await this.prisma.collection.findMany({
      include: { requests: true },
    });
    const allowedIds = new Set<string>([collectionId]);
    let added = true;
    while (added) {
      added = false;
      for (const c of allCols) {
        if (c.parentId && allowedIds.has(c.parentId) && !allowedIds.has(c.id)) {
          allowedIds.add(c.id);
          added = true;
        }
      }
    }

    const candidates = allCols
      .filter((c) => allowedIds.has(c.id))
      .flatMap((c) => c.requests);

    const method = req.method.toUpperCase();
    const match = candidates.find(
      (r) =>
        r.method === method &&
        this.pathMatches(this.normalizePath(r.url), incomingPath),
    );

    if (!match) {
      return res.status(404).json({
        mockError: 'No matching endpoint found in collection',
        method,
        path: incomingPath,
      });
    }

    const delayMs = Number(
      req.headers['x-mock-delay'] ?? req.query.mock_delay ?? 0,
    );
    if (delayMs > 0 && delayMs <= 10_000) {
      await new Promise((r) => setTimeout(r, delayMs));
    }

    const overrideStatus = Number(
      req.headers['x-mock-status'] ?? req.query.mock_status ?? 0,
    );
    const requestedExampleName = String(
      req.headers['x-mock-response-name'] ?? req.query.mock_name ?? '',
    ).trim();

    const examples = Array.isArray(match.examples)
      ? (match.examples as unknown as ResponseExample[])
      : [];
    const ex = requestedExampleName
      ? examples.find(
          (item) => item.name.toLowerCase() === requestedExampleName.toLowerCase(),
        ) ?? examples[0]
      : examples[0];
    if (ex) {
      for (const [k, v] of Object.entries(ex.headers ?? {})) {
        const lk = k.toLowerCase();
        if (lk !== 'content-length' && lk !== 'transfer-encoding') {
          res.setHeader(k, v);
        }
      }
      return res
        .status(overrideStatus || ex.statusCode || 200)
        .send(this.interpolateFaker(ex.body ?? ''));
    }

    const bodyCfg = match.body as { mode?: string; raw?: string } | null;
    if (bodyCfg?.mode === 'raw' && bodyCfg.raw) {
      res.setHeader('Content-Type', 'application/json');
      return res
        .status(overrideStatus || 200)
        .send(this.interpolateFaker(bodyCfg.raw));
    }

    return res.status(overrideStatus || 200).json({
      mocked: true,
      request: match.name,
      method,
      path: incomingPath,
    });
  }
}
