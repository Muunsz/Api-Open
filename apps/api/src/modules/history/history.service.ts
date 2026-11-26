import { Injectable } from '@nestjs/common';
import { HttpMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';

@Injectable()
export class HistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  async list(workspaceId: string, userId: string, limit = 100) {
    await this.workspaceService.assertAccess(workspaceId, userId);
    return this.prisma.requestHistory.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  async create(
    workspaceId: string,
    userId: string,
    body: {
      method: HttpMethod;
      url: string;
      statusCode?: number;
      durationMs?: number;
      requestSnapshot?: Prisma.InputJsonValue;
    },
  ) {
    await this.workspaceService.assertAccess(workspaceId, userId);
    return this.prisma.requestHistory.create({
      data: {
        workspaceId,
        userId,
        method: body.method,
        url: body.url,
        statusCode: body.statusCode ?? null,
        durationMs: body.durationMs ?? null,
        requestSnapshot: body.requestSnapshot ?? {},
      },
    });
  }

  async clear(workspaceId: string, userId: string) {
    await this.workspaceService.assertAccess(workspaceId, userId);
    await this.prisma.requestHistory.deleteMany({ where: { workspaceId } });
    return { cleared: true };
  }
}
