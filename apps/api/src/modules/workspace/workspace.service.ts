import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { renderWorkspaceInviteEmail } from '../mail/email-templates';
import { MailService } from '../mail/mail.service';

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async listForUser(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });

    if (memberships.length === 0) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });
      if (user) {
        const wsName = `${user.name || user.email.split('@')[0]}'s Workspace`;
        const created = await this.prisma.workspace.create({
          data: {
            name: wsName,
            type: 'PERSONAL',
            members: {
              create: {
                userId,
                role: 'OWNER',
              },
            },
          },
        });
        return [{ ...created, role: WorkspaceRole.OWNER }];
      }
    }

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

  async updateWorkspace(
    workspaceId: string,
    userId: string,
    data: { name?: string; summary?: string; readme?: string },
  ) {
    const membership = await this.assertAccess(workspaceId, userId, [
      'OWNER',
      'EDITOR',
    ]);
    const nextName = data.name?.trim();
    if (data.name !== undefined && !nextName) {
      throw new BadRequestException('Workspace name cannot be empty');
    }

    const updateData: { name?: string; summary?: string; readme?: string } = {};
    if (nextName !== undefined) updateData.name = nextName;
    if (data.summary !== undefined) updateData.summary = data.summary;
    if (data.readme !== undefined) updateData.readme = data.readme;

    const updated =
      Object.keys(updateData).length > 0
        ? await this.prisma.workspace.update({
            where: { id: workspaceId },
            data: updateData,
          })
        : await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
          });

    if (!updated) {
      throw new BadRequestException('Workspace not found');
    }

    return {
      ...updated,
      role: membership.role,
    };
  }

  async listMembers(workspaceId: string, userId: string) {
    await this.assertAccess(workspaceId, userId);
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: { select: { id: true, email: true, name: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async inviteMember(
    workspaceId: string,
    inviterId: string,
    email: string,
    role: WorkspaceRole = 'EDITOR',
  ) {
    await this.assertAccess(workspaceId, inviterId, ['OWNER']);

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) throw new BadRequestException('Workspace not found');

    const targetUser = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (targetUser) {
      await this.prisma.workspaceMember.upsert({
        where: {
          workspaceId_userId: { workspaceId, userId: targetUser.id },
        },
        update: { role },
        create: { workspaceId, userId: targetUser.id, role },
      });
    }

    const inviter = await this.prisma.user.findUnique({
      where: { id: inviterId },
      select: { name: true, email: true },
    });
    const inviterLabel = inviter?.name || inviter?.email || 'A teammate';
    const appUrl =
      process.env.CORS_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:9999';

    const renderedInvite = renderWorkspaceInviteEmail({
      inviterLabel,
      workspaceName: workspace.name,
      role,
      recipientEmail: email.trim(),
      appUrl,
    });

    const mailResult = await this.mailService.sendEmail({
      to: email.trim(),
      subject: renderedInvite.subject,
      userId: inviterId,
      workspaceId,
      category: 'invite',
      text: renderedInvite.text,
      html: renderedInvite.html,
    });

    return {
      addedImmediately: Boolean(targetUser),
      emailSent: mailResult.success,
      email: email.trim(),
      role,
    };
  }

  async updateMemberRole(
    workspaceId: string,
    actorId: string,
    memberId: string,
    role: WorkspaceRole,
  ) {
    await this.assertAccess(workspaceId, actorId, ['OWNER']);
    const member = await this.prisma.workspaceMember.findUnique({
      where: { id: memberId },
    });
    if (!member || member.workspaceId !== workspaceId) {
      throw new BadRequestException('Member not found');
    }
    if (member.userId === actorId && role !== 'OWNER') {
      throw new BadRequestException('Cannot downgrade your own owner role');
    }
    return this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role },
      include: {
        user: { select: { id: true, email: true, name: true, avatarUrl: true } },
      },
    });
  }

  async deleteWorkspace(workspaceId: string, actorId: string) {
    await this.assertAccess(workspaceId, actorId, ['OWNER']);
    await this.prisma.workspace.delete({ where: { id: workspaceId } });
    return { deleted: true, id: workspaceId };
  }

  async removeMember(workspaceId: string, actorId: string, memberId: string) {
    await this.assertAccess(workspaceId, actorId, ['OWNER']);
    const member = await this.prisma.workspaceMember.findUnique({
      where: { id: memberId },
    });
    if (!member || member.workspaceId !== workspaceId) {
      throw new BadRequestException('Member not found');
    }
    if (member.userId === actorId) {
      throw new BadRequestException('Cannot remove yourself as owner');
    }
    await this.prisma.workspaceMember.delete({ where: { id: memberId } });
    return { deleted: true, id: memberId };
  }

  async getProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, avatarUrl: true },
    });
  }

  async updateProfile(
    userId: string,
    data: { name?: string; avatarUrl?: string | null },
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.avatarUrl !== undefined
          ? { avatarUrl: data.avatarUrl?.trim() || null }
          : {}),
      },
      select: { id: true, email: true, name: true, avatarUrl: true },
    });
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

  async listActivityLogs(
    userId: string,
    workspaceId?: string,
    limit = 100,
  ) {
    return this.prisma.activityLog.findMany({
      where: {
        userId,
        ...(workspaceId ? { workspaceId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit || 100, 1), 200),
    });
  }

  async createActivityLog(
    userId: string,
    data: {
      type: string;
      method?: string;
      url?: string;
      statusCode?: number;
      durationMs?: number;
      message: string;
      workspaceId?: string;
    },
  ) {
    return this.prisma.activityLog.create({
      data: {
        userId,
        workspaceId: data.workspaceId || null,
        type: data.type || 'activity',
        method: data.method || null,
        url: data.url || null,
        statusCode: data.statusCode ?? null,
        durationMs: data.durationMs ?? null,
        message: data.message,
      },
    });
  }

  async clearActivityLogs(userId: string, workspaceId?: string) {
    await this.prisma.activityLog.deleteMany({
      where: {
        userId,
        ...(workspaceId ? { workspaceId } : {}),
      },
    });
    return { cleared: true };
  }

  async listEmailLogs(userId: string, userEmail?: string, limit = 100) {
    return this.prisma.emailLog.findMany({
      where: {
        OR: [
          { userId },
          ...(userEmail ? [{ to: userEmail.trim().toLowerCase() }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit || 100, 1), 200),
    });
  }
}
