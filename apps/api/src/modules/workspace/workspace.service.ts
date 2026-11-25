import { ForbiddenException, Injectable } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class WorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => ({
      ...m.workspace,
      role: m.role,
    }));
  }

  async createTeamWorkspace(userId: string, name: string) {
    const workspace = await this.prisma.workspace.create({
      data: {
        name: name.trim(),
        type: 'TEAM',
        members: {
          create: {
            userId,
            role: 'OWNER',
          },
        },
      },
    });
    return { ...workspace, role: WorkspaceRole.OWNER };
  }

  async assertAccess(
    workspaceId: string,
    userId: string,
    allowedRoles: WorkspaceRole[] = ['OWNER', 'EDITOR', 'VIEWER'],
  ) {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId },
      },
    });

    if (!membership || !allowedRoles.includes(membership.role)) {
      throw new ForbiddenException('You do not have access to this workspace');
    }

    return membership;
  }
}
