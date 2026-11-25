import { Injectable, NotFoundException } from '@nestjs/common';
import { HttpMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';

export interface SaveRequestDto {
  name?: string;
  method?: HttpMethod;
  url?: string;
  headers?: Prisma.InputJsonValue;
  queryParams?: Prisma.InputJsonValue;
  auth?: Prisma.InputJsonValue;
  body?: Prisma.InputJsonValue;
  preRequestScript?: string | null;
  testScript?: string | null;
  order?: number;
}

@Injectable()
export class RequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  async create(collectionId: string, userId: string, data: SaveRequestDto) {
    const collection = await this.prisma.collection.findUnique({
      where: { id: collectionId },
    });
    if (!collection) throw new NotFoundException('Collection not found');

    await this.workspaceService.assertAccess(collection.workspaceId, userId, [
      'OWNER',
      'EDITOR',
    ]);

    return this.prisma.apiRequest.create({
      data: {
        collectionId,
        name: data.name?.trim() || 'Untitled Request',
        method: data.method ?? 'GET',
        url: data.url ?? '',
        headers: data.headers ?? [],
        queryParams: data.queryParams ?? [],
        auth: data.auth ?? { type: 'none' },
        body: data.body ?? { mode: 'none' },
        preRequestScript: data.preRequestScript ?? null,
        testScript: data.testScript ?? null,
      },
    });
  }

  async update(id: string, userId: string, data: SaveRequestDto) {
    const existing = await this.prisma.apiRequest.findUnique({
      where: { id },
      include: { collection: true },
    });
    if (!existing) throw new NotFoundException('Request not found');

    await this.workspaceService.assertAccess(
      existing.collection.workspaceId,
      userId,
      ['OWNER', 'EDITOR'],
    );

    return this.prisma.apiRequest.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.method !== undefined ? { method: data.method } : {}),
        ...(data.url !== undefined ? { url: data.url } : {}),
        ...(data.headers !== undefined ? { headers: data.headers } : {}),
        ...(data.queryParams !== undefined
          ? { queryParams: data.queryParams }
          : {}),
        ...(data.auth !== undefined ? { auth: data.auth } : {}),
        ...(data.body !== undefined ? { body: data.body } : {}),
        ...(data.preRequestScript !== undefined
          ? { preRequestScript: data.preRequestScript }
          : {}),
        ...(data.testScript !== undefined
          ? { testScript: data.testScript }
          : {}),
        ...(data.order !== undefined ? { order: data.order } : {}),
      },
    });
  }

  async remove(id: string, userId: string) {
    const existing = await this.prisma.apiRequest.findUnique({
      where: { id },
      include: { collection: true },
    });
    if (!existing) throw new NotFoundException('Request not found');

    await this.workspaceService.assertAccess(
      existing.collection.workspaceId,
      userId,
      ['OWNER', 'EDITOR'],
    );

    await this.prisma.apiRequest.delete({ where: { id } });
    return { deleted: true, id };
  }
}
