import { Injectable, NotFoundException } from '@nestjs/common';
import type { EnvVariable } from '@api-open/shared';
import { Prisma } from '@prisma/client';
import { decryptSecret, encryptSecret } from '../../common/crypto.util';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';

@Injectable()
export class EnvironmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  private encryptVariables(vars: EnvVariable[]): Prisma.InputJsonValue {
    return vars.map((v) => ({
      ...v,
      value: v.isSecret ? encryptSecret(v.value) : v.value,
    })) as unknown as Prisma.InputJsonValue;
  }

  private decryptVariables(raw: Prisma.JsonValue): EnvVariable[] {
    if (!Array.isArray(raw)) return [];
    return (raw as unknown as EnvVariable[]).map((v) => ({
      ...v,
      value: v.isSecret ? decryptSecret(v.value) : v.value,
    }));
  }

  async listByWorkspace(workspaceId: string, userId: string) {
    await this.workspaceService.assertAccess(workspaceId, userId);
    const list = await this.prisma.environment.findMany({
      where: { workspaceId },
      orderBy: [{ isGlobal: 'desc' }, { createdAt: 'asc' }],
    });
    return list.map((env) => ({
      ...env,
      variables: this.decryptVariables(env.variables),
    }));
  }

  async create(
    workspaceId: string,
    userId: string,
    data: { name: string; isGlobal?: boolean; variables?: EnvVariable[] },
  ) {
    await this.workspaceService.assertAccess(workspaceId, userId, [
      'OWNER',
      'EDITOR',
    ]);
    const created = await this.prisma.environment.create({
      data: {
        workspaceId,
        name: data.name.trim(),
        isGlobal: data.isGlobal ?? false,
        variables: this.encryptVariables(data.variables ?? []),
      },
    });
    return {
      ...created,
      variables: this.decryptVariables(created.variables),
    };
  }

  async update(
    id: string,
    userId: string,
    data: { name?: string; variables?: EnvVariable[] },
  ) {
    const existing = await this.prisma.environment.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Environment not found');

    await this.workspaceService.assertAccess(existing.workspaceId, userId, [
      'OWNER',
      'EDITOR',
    ]);

    const updated = await this.prisma.environment.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.variables !== undefined
          ? { variables: this.encryptVariables(data.variables) }
          : {}),
      },
    });
    return {
      ...updated,
      variables: this.decryptVariables(updated.variables),
    };
  }

  async remove(id: string, userId: string) {
    const existing = await this.prisma.environment.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Environment not found');

    await this.workspaceService.assertAccess(existing.workspaceId, userId, [
      'OWNER',
      'EDITOR',
    ]);

    await this.prisma.environment.delete({ where: { id } });
    return { deleted: true, id };
  }
}
