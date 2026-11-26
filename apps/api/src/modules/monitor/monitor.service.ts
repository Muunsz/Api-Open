import {
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { AuthConfig, BodyConfig, HttpMethod, KeyValueItem } from '@api-open/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ProxyService } from '../proxy/proxy.service';
import { WorkspaceService } from '../workspace/workspace.service';

@Injectable()
export class MonitorService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceService: WorkspaceService,
    private readonly proxyService: ProxyService,
  ) {}

  onModuleInit() {
    if (process.env.VERCEL) return;
    this.timer = setInterval(() => {
      this.tickDueMonitors().catch(() => undefined);
    }, 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tickDueMonitors() {
    const monitors = await this.prisma.monitor.findMany({
      where: { enabled: true },
    });
    const now = Date.now();
    for (const mon of monitors) {
      const intervalMs = Math.max(mon.intervalMinutes, 1) * 60_000;
      const last = mon.lastRunAt ? mon.lastRunAt.getTime() : 0;
      if (now - last >= intervalMs) {
        await this.executeMonitor(mon.id).catch(() => undefined);
      }
    }
  }

  async list(workspaceId: string, userId: string) {
    await this.workspaceService.assertAccess(workspaceId, userId);
    return this.prisma.monitor.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    workspaceId: string,
    userId: string,
    body: { collectionId: string; name: string; intervalMinutes?: number },
  ) {
    await this.workspaceService.assertAccess(workspaceId, userId, [
      'OWNER',
      'EDITOR',
    ]);
    return this.prisma.monitor.create({
      data: {
        workspaceId,
        collectionId: body.collectionId,
        name: body.name.trim() || 'Collection Monitor',
        intervalMinutes: Math.max(1, body.intervalMinutes ?? 60),
      },
    });
  }

  async update(
    id: string,
    userId: string,
    body: { name?: string; intervalMinutes?: number; enabled?: boolean },
  ) {
    const existing = await this.prisma.monitor.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Monitor not found');
    await this.workspaceService.assertAccess(existing.workspaceId, userId, [
      'OWNER',
      'EDITOR',
    ]);
    return this.prisma.monitor.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.intervalMinutes !== undefined
          ? { intervalMinutes: Math.max(1, body.intervalMinutes) }
          : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      },
    });
  }

  async remove(id: string, userId: string) {
    const existing = await this.prisma.monitor.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Monitor not found');
    await this.workspaceService.assertAccess(existing.workspaceId, userId, [
      'OWNER',
      'EDITOR',
    ]);
    await this.prisma.monitor.delete({ where: { id } });
    return { deleted: true, id };
  }

  async runNow(id: string, userId: string) {
    const existing = await this.prisma.monitor.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Monitor not found');
    await this.workspaceService.assertAccess(existing.workspaceId, userId);
    return this.executeMonitor(id);
  }

  private async executeMonitor(monitorId: string) {
    const mon = await this.prisma.monitor.findUnique({
      where: { id: monitorId },
    });
    if (!mon) throw new NotFoundException('Monitor not found');

    const requests = await this.prisma.apiRequest.findMany({
      where: { collectionId: mon.collectionId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });

    let passed = 0;
    let failed = 0;

    for (const req of requests) {
      if (!req.url || !/^https?:\/\//i.test(req.url)) continue;
      const headers: Record<string, string> = {};
      for (const h of (req.headers as unknown as KeyValueItem[]) ?? []) {
        if (h.enabled && h.key) headers[h.key] = h.value ?? '';
      }
      const queryParams: Record<string, string> = {};
      for (const q of (req.queryParams as unknown as KeyValueItem[]) ?? []) {
        if (q.enabled && q.key) queryParams[q.key] = q.value ?? '';
      }
      try {
        const res = await this.proxyService.execute({
          method: req.method as HttpMethod,
          url: req.url,
          headers,
          queryParams,
          auth: req.auth as unknown as AuthConfig,
          body: req.body as unknown as BodyConfig,
        });
        if (res.statusCode >= 200 && res.statusCode < 400) passed++;
        else failed++;
      } catch {
        failed++;
      }
    }

    const lastStatus = failed === 0 ? 'healthy' : 'failing';
    return this.prisma.monitor.update({
      where: { id: monitorId },
      data: {
        lastRunAt: new Date(),
        lastStatus,
        lastPassed: passed,
        lastFailed: failed,
      },
    });
  }
}
