import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';

@Injectable()
export class CollectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  async listByWorkspace(workspaceId: string, userId: string) {
    await this.workspaceService.assertAccess(workspaceId, userId);
    return this.prisma.collection.findMany({
      where: { workspaceId },
      include: {
        requests: {
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(
    workspaceId: string,
    userId: string,
    data: { name: string; parentId?: string },
  ) {
    await this.workspaceService.assertAccess(workspaceId, userId, [
      'OWNER',
      'EDITOR',
    ]);
    return this.prisma.collection.create({
      data: {
        workspaceId,
        name: data.name.trim(),
        parentId: data.parentId ?? null,
      },
      include: { requests: true },
    });
  }

  async update(
    id: string,
    userId: string,
    data: { name?: string; parentId?: string | null; order?: number },
  ) {
    const existing = await this.prisma.collection.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Collection not found');

    await this.workspaceService.assertAccess(existing.workspaceId, userId, [
      'OWNER',
      'EDITOR',
    ]);

    return this.prisma.collection.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
        ...(data.order !== undefined ? { order: data.order } : {}),
      },
      include: { requests: true },
    });
  }

  async remove(id: string, userId: string) {
    const existing = await this.prisma.collection.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Collection not found');

    await this.workspaceService.assertAccess(existing.workspaceId, userId, [
      'OWNER',
      'EDITOR',
    ]);

    await this.prisma.collection.delete({ where: { id } });
    return { deleted: true, id };
  }
}
