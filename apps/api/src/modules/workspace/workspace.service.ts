import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
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

    const mailResult = await this.mailService.sendEmail({
      to: email.trim(),
      subject: `Invitation to join "${workspace.name}" on Api-Open`,
      text: `You have been invited as ${role} to workspace "${workspace.name}" on Api-Open.`,
      html: `<p>You have been invited as <b>${role}</b> to workspace <b>${workspace.name}</b> on Api-Open.</p>`,
    });

    return {
      addedImmediately: Boolean(targetUser),
      emailSent: mailResult.success,
      email: email.trim(),
      role,
    };
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
