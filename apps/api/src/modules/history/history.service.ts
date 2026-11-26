import { Injectable } from '@nestjs/common';
import { HttpMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';

const MAX_HISTORY_PER_ACCOUNT = 35;

@Injectable()
export class HistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  async list(
    workspaceId: string,
    userId: string,
    limit = MAX_HISTORY_PER_ACCOUNT,
  ) {
    await this.workspaceService.assertAccess(workspaceId, userId);
    return this.prisma.requestHistory.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(limit, 1), MAX_HISTORY_PER_ACCOUNT),
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
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.requestHistory.create({
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

      const overflow = await tx.requestHistory.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: MAX_HISTORY_PER_ACCOUNT,
        select: { id: true },
      });

      if (overflow.length > 0) {
        await tx.requestHistory.deleteMany({
          where: { id: { in: overflow.map((row) => row.id) } },
        });
      }

      return created;
    });
  }

  async clear(workspaceId: string, userId: string) {
    await this.workspaceService.assertAccess(workspaceId, userId);
    await this.prisma.requestHistory.deleteMany({ where: { workspaceId } });
    return { cleared: true };
  }
}
