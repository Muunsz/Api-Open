import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';

export interface SaveCollectionDto {
  name?: string;
  parentId?: string | null;
  order?: number;
  auth?: Prisma.InputJsonValue;
  headers?: Prisma.InputJsonValue;
  variables?: Prisma.InputJsonValue;
}

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

  async create(workspaceId: string, userId: string, data: SaveCollectionDto) {
    await this.workspaceService.assertAccess(workspaceId, userId, [
      'OWNER',
      'EDITOR',
    ]);

    if (data.parentId) {
      const parent = await this.prisma.collection.findUnique({
        where: { id: data.parentId },
      });
      if (!parent || parent.workspaceId !== workspaceId) {
        throw new BadRequestException('Parent folder not found in workspace');
      }
    }

    return this.prisma.collection.create({
      data: {
        workspaceId,
        name: data.name?.trim() || 'New Collection',
        parentId: data.parentId ?? null,
        auth: data.auth ?? { type: 'none' },
        headers: data.headers ?? [],
        variables: data.variables ?? [],
      },
      include: { requests: true },
    });
  }

  async update(id: string, userId: string, data: SaveCollectionDto) {
    const existing = await this.prisma.collection.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Collection not found');

    await this.workspaceService.assertAccess(existing.workspaceId, userId, [
      'OWNER',
      'EDITOR',
    ]);

    if (data.parentId === id) {
      throw new BadRequestException('A folder cannot be its own parent');
    }

    return this.prisma.collection.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
        ...(data.order !== undefined ? { order: data.order } : {}),
        ...(data.auth !== undefined ? { auth: data.auth } : {}),
        ...(data.headers !== undefined ? { headers: data.headers } : {}),
        ...(data.variables !== undefined ? { variables: data.variables } : {}),
      },
      include: { requests: true },
    });
  }

  /**
   * Deep-duplicates a collection (folder) including its requests and nested
   * sub-folders. The copy is placed next to the original (same parent).
   */
  async duplicate(id: string, userId: string) {
    const existing = await this.prisma.collection.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Collection not found');

    await this.workspaceService.assertAccess(existing.workspaceId, userId, [
      'OWNER',
      'EDITOR',
    ]);

    const all = await this.prisma.collection.findMany({
      where: { workspaceId: existing.workspaceId },
      include: { requests: true },
    });

    const copyTree = async (
      sourceId: string,
      parentId: string | null,
      nameOverride?: string,
    ): Promise<string> => {
      const src = all.find((c) => c.id === sourceId);
      if (!src) throw new NotFoundException('Collection not found');
      const created = await this.prisma.collection.create({
        data: {
          workspaceId: src.workspaceId,
          parentId,
          name: nameOverride ?? src.name,
          auth: src.auth as Prisma.InputJsonValue,
          headers: src.headers as Prisma.InputJsonValue,
          variables: src.variables as Prisma.InputJsonValue,
          order: src.order,
        },
      });
      for (const req of src.requests) {
        await this.prisma.apiRequest.create({
          data: {
            collectionId: created.id,
            name: req.name,
            method: req.method,
            url: req.url,
            headers: req.headers as Prisma.InputJsonValue,
            queryParams: req.queryParams as Prisma.InputJsonValue,
            pathParams: req.pathParams as Prisma.InputJsonValue,
            examples: req.examples as Prisma.InputJsonValue,
            auth: req.auth as Prisma.InputJsonValue,
            body: req.body as Prisma.InputJsonValue,
            preRequestScript: req.preRequestScript,
            testScript: req.testScript,
            order: req.order,
          },
        });
      }
      for (const child of all.filter((c) => c.parentId === src.id)) {
        await copyTree(child.id, created.id);
      }
      return created.id;
    };

    const newId = await copyTree(
      existing.id,
      existing.parentId,
      `${existing.name} Copy`,
    );
    return this.prisma.collection.findUnique({
      where: { id: newId },
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

  async listSnapshots(collectionId: string, userId: string) {
    const col = await this.prisma.collection.findUnique({ where: { id: collectionId } });
    if (!col) throw new NotFoundException('Collection not found');
    await this.workspaceService.assertAccess(col.workspaceId, userId);
    return this.prisma.collectionSnapshot.findMany({
      where: { collectionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createSnapshot(
    collectionId: string,
    userId: string,
    version: string,
    note?: string,
  ) {
    const col = await this.prisma.collection.findUnique({
      where: { id: collectionId },
      include: { requests: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!col) throw new NotFoundException('Collection not found');
    await this.workspaceService.assertAccess(col.workspaceId, userId, [
      'OWNER',
      'EDITOR',
    ]);
    return this.prisma.collectionSnapshot.create({
      data: {
        collectionId,
        version: version.trim() || `v${new Date().toISOString().slice(0, 16)}`,
        note: note?.trim() || null,
        data: {
          name: col.name,
          auth: col.auth,
          headers: col.headers,
          variables: col.variables,
          requests: col.requests,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async restoreSnapshot(snapshotId: string, userId: string) {
    const snap = await this.prisma.collectionSnapshot.findUnique({
      where: { id: snapshotId },
      include: { collection: true },
    });
    if (!snap) throw new NotFoundException('Snapshot not found');
    await this.workspaceService.assertAccess(snap.collection.workspaceId, userId, [
      'OWNER',
      'EDITOR',
    ]);

    const payload = snap.data as {
      name?: string;
      auth?: Prisma.InputJsonValue;
      headers?: Prisma.InputJsonValue;
      variables?: Prisma.InputJsonValue;
      requests?: Array<{
        name: string;
        method: any;
        url: string;
        headers: Prisma.InputJsonValue;
        queryParams: Prisma.InputJsonValue;
        pathParams?: Prisma.InputJsonValue;
        auth: Prisma.InputJsonValue;
        body: Prisma.InputJsonValue;
        examples?: Prisma.InputJsonValue;
        settings?: Prisma.InputJsonValue;
        preRequestScript?: string | null;
        testScript?: string | null;
        order?: number;
      }>;
    };

    await this.prisma.collection.update({
      where: { id: snap.collectionId },
      data: {
        ...(payload.name ? { name: payload.name } : {}),
        ...(payload.auth ? { auth: payload.auth } : {}),
        ...(payload.headers ? { headers: payload.headers } : {}),
        ...(payload.variables ? { variables: payload.variables } : {}),
      },
    });

    await this.prisma.apiRequest.deleteMany({
      where: { collectionId: snap.collectionId },
    });

    for (const req of payload.requests ?? []) {
      await this.prisma.apiRequest.create({
        data: {
          collectionId: snap.collectionId,
          name: req.name,
          method: req.method,
          url: req.url,
          headers: req.headers ?? [],
          queryParams: req.queryParams ?? [],
          pathParams: req.pathParams ?? [],
          auth: req.auth ?? { type: 'none' },
          body: req.body ?? { mode: 'none' },
          examples: req.examples ?? [],
          settings: req.settings ?? {},
          preRequestScript: req.preRequestScript ?? null,
          testScript: req.testScript ?? null,
          order: req.order ?? 0,
        },
      });
    }

    return { restored: true, collectionId: snap.collectionId };
  }

  async getPublicDocs(collectionId: string) {
    const col = await this.prisma.collection.findUnique({
      where: { id: collectionId },
      include: {
        requests: {
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!col) throw new NotFoundException('Collection not found');
    const children = await this.prisma.collection.findMany({
      where: { parentId: collectionId },
      include: {
        requests: {
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      id: col.id,
      name: col.name,
      requests: col.requests,
      folders: children.map((c) => ({
        id: c.id,
        name: c.name,
        requests: c.requests,
      })),
    };
  }
}
