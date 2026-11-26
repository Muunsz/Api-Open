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
  pathParams?: Prisma.InputJsonValue;
  auth?: Prisma.InputJsonValue;
  body?: Prisma.InputJsonValue;
  examples?: Prisma.InputJsonValue;
  settings?: Prisma.InputJsonValue;
  collectionId?: string;
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
        pathParams: data.pathParams ?? [],
        auth: data.auth ?? { type: 'none' },
        body: data.body ?? { mode: 'none' },
        examples: data.examples ?? [],
        settings: data.settings ?? {},
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
        ...(data.pathParams !== undefined
          ? { pathParams: data.pathParams }
          : {}),
        ...(data.auth !== undefined ? { auth: data.auth } : {}),
        ...(data.body !== undefined ? { body: data.body } : {}),
        ...(data.examples !== undefined ? { examples: data.examples } : {}),
        ...(data.settings !== undefined ? { settings: data.settings } : {}),
        ...(data.collectionId !== undefined
          ? { collectionId: data.collectionId }
          : {}),
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

  async duplicate(id: string, userId: string) {
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

    return this.prisma.apiRequest.create({
      data: {
        collectionId: existing.collectionId,
        name: `${existing.name} (Copy)`,
        method: existing.method,
        url: existing.url,
        headers: existing.headers as Prisma.InputJsonValue,
        queryParams: existing.queryParams as Prisma.InputJsonValue,
        pathParams: existing.pathParams as Prisma.InputJsonValue,
        auth: existing.auth as Prisma.InputJsonValue,
        body: existing.body as Prisma.InputJsonValue,
        examples: existing.examples as Prisma.InputJsonValue,
        preRequestScript: existing.preRequestScript,
        testScript: existing.testScript,
      },
    });
  }

  async listComments(requestId: string, userId: string) {
    const req = await this.prisma.apiRequest.findUnique({
      where: { id: requestId },
      include: { collection: true },
    });
    if (!req) throw new NotFoundException('Request not found');
    await this.workspaceService.assertAccess(
      req.collection.workspaceId,
      userId,
    );
    return this.prisma.requestComment.findMany({
      where: { requestId },
      include: {
        user: { select: { id: true, email: true, name: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addComment(requestId: string, userId: string, content: string) {
    const req = await this.prisma.apiRequest.findUnique({
      where: { id: requestId },
      include: { collection: true },
    });
    if (!req) throw new NotFoundException('Request not found');
    await this.workspaceService.assertAccess(
      req.collection.workspaceId,
      userId,
    );
    return this.prisma.requestComment.create({
      data: { requestId, userId, content: content.trim() },
      include: {
        user: { select: { id: true, email: true, name: true, avatarUrl: true } },
      },
    });
  }

  async deleteComment(commentId: string, userId: string) {
    const comment = await this.prisma.requestComment.findUnique({
      where: { id: commentId },
      include: { request: { include: { collection: true } } },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    await this.workspaceService.assertAccess(
      comment.request.collection.workspaceId,
      userId,
    );
    await this.prisma.requestComment.delete({ where: { id: commentId } });
    return { deleted: true, id: commentId };
  }
}
