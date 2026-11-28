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

    const cleanEmail = email.trim().toLowerCase();
    const targetUser = await this.prisma.user.findUnique({
      where: { email: cleanEmail },
    });

    const inviter = await this.prisma.user.findUnique({
      where: { id: inviterId },
      select: { name: true, email: true },
    });
    const inviterLabel = inviter?.name || inviter?.email || 'A teammate';

    let alreadyMember = false;
    if (targetUser) {
      const existingMember = await this.prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId, userId: targetUser.id },
        },
      });
      if (existingMember) {
        alreadyMember = true;
        await this.prisma.workspaceMember.update({
          where: { id: existingMember.id },
          data: { role },
        });
      }
    }

    if (!alreadyMember) {
      await this.prisma.workspaceInvitation.upsert({
        where: {
          workspaceId_email: { workspaceId, email: cleanEmail },
        },
        update: {
          role,
          inviterId,
          inviterLabel,
          userId: targetUser?.id ?? null,
          status: 'PENDING',
        },
        create: {
          workspaceId,
          email: cleanEmail,
          userId: targetUser?.id ?? null,
          inviterId,
          inviterLabel,
          role,
          status: 'PENDING',
        },
      });

      if (targetUser) {
        await this.prisma.activityLog.create({
          data: {
            userId: targetUser.id,
            workspaceId,
            type: 'activity',
            message: `${inviterLabel} invited you as ${role} to workspace "${workspace.name}" (waiting for acceptance)`,
          },
        });
      }
    }

    return {
      addedImmediately: alreadyMember,
      pendingAcceptance: !alreadyMember,
      notified: Boolean(targetUser),
      email: cleanEmail,
      role,
      workspaceName: workspace.name,
      inviterLabel,
    };
  }

  async listPendingInvitations(userId: string, userEmail?: string) {
    const cleanEmail = userEmail?.trim().toLowerCase();
    const filters: Array<{ userId?: string; email?: string }> = [{ userId }];
    if (cleanEmail) {
      filters.push({ email: cleanEmail });
    }
    return this.prisma.workspaceInvitation.findMany({
      where: {
        status: 'PENDING',
        OR: filters,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        workspace: { select: { id: true, name: true, type: true } },
      },
    });
  }

  async acceptInvitation(
    invitationId: string,
    userId: string,
    userEmail?: string,
  ) {
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { id: invitationId },
      include: { workspace: { select: { id: true, name: true } } },
    });
    const cleanEmail = userEmail?.trim().toLowerCase();
    const isRecipient =
      invitation &&
      (invitation.userId === userId ||
        (cleanEmail && invitation.email.toLowerCase() === cleanEmail));

    if (!invitation || !isRecipient) {
      throw new ForbiddenException('Invitation not found for this account');
    }
    if (invitation.status !== 'PENDING') {
      throw new BadRequestException('Invitation is no longer pending');
    }

    await this.prisma.$transaction([
      this.prisma.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED', userId },
      }),
      this.prisma.workspaceMember.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: invitation.workspaceId,
            userId,
          },
        },
        update: { role: invitation.role },
        create: {
          workspaceId: invitation.workspaceId,
          userId,
          role: invitation.role,
        },
      }),
      this.prisma.activityLog.create({
        data: {
          userId,
          workspaceId: invitation.workspaceId,
          type: 'activity',
          message: `Accepted invitation to join workspace "${invitation.workspace.name}" as ${invitation.role}`,
        },
      }),
    ]);

    return {
      accepted: true,
      workspaceId: invitation.workspaceId,
      workspaceName: invitation.workspace.name,
      role: invitation.role,
    };
  }

  async declineInvitation(
    invitationId: string,
    userId: string,
    userEmail?: string,
  ) {
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { id: invitationId },
    });
    const cleanEmail = userEmail?.trim().toLowerCase();
    const isRecipient =
      invitation &&
      (invitation.userId === userId ||
        (cleanEmail && invitation.email.toLowerCase() === cleanEmail));

    if (!invitation || !isRecipient) {
      throw new ForbiddenException('Invitation not found for this account');
    }
    if (invitation.status !== 'PENDING') {
      return { declined: true, id: invitation.id };
    }

    await this.prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { status: 'DECLINED', userId },
    });
    return { declined: true, id: invitation.id };
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
