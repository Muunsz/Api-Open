import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpMethod, WorkspaceType } from '@prisma/client';
import * as crypto from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

export interface AdminTokenPayload {
  sub: string;
  role: 'superadmin';
  iat: number;
  exp: number;
}

@Injectable()
export class AdminService {
  private readonly failedAttempts = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private getSigningSecret(): string {
    const explicit = this.config.get<string>('ADMIN_JWT_SECRET')?.trim();
    if (explicit) return explicit;
    const serviceKey = this.config
      .get<string>('SUPABASE_SERVICE_ROLE_KEY')
      ?.trim();
    const dbUrl = this.config.get<string>('DATABASE_URL')?.trim();
    const seed = serviceKey || dbUrl || 'api-open-admin-ephemeral';
    return crypto.createHash('sha256').update(`admin-backpanel:${seed}`).digest('hex');
  }

  private safeEqual(a: string, b: string): boolean {
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ha, hb);
  }

  private checkRateLimit(clientKey: string) {
    const now = Date.now();
    const entry = this.failedAttempts.get(clientKey);
    if (entry && entry.resetAt > now && entry.count >= 5) {
      const waitSec = Math.ceil((entry.resetAt - now) / 1000);
      throw new HttpException(
        `Too many failed login attempts. Try again in ${waitSec}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (entry && entry.resetAt <= now) {
      this.failedAttempts.delete(clientKey);
    }
  }

  private recordFailure(clientKey: string) {
    const now = Date.now();
    const prev = this.failedAttempts.get(clientKey);
    if (!prev || prev.resetAt <= now) {
      this.failedAttempts.set(clientKey, {
        count: 1,
        resetAt: now + 5 * 60 * 1000,
      });
    } else {
      prev.count += 1;
    }
  }

  login(identifier: string, password: string, clientKey: string) {
    this.checkRateLimit(clientKey);

    const expectedPass = this.config.get<string>('ADMIN_PASSWORD')?.trim();
    if (!expectedPass) {
      throw new BadRequestException(
        'ADMIN_PASSWORD is not configured on the API server.',
      );
    }

    const expectedEmail = (
      this.config.get<string>('ADMIN_EMAIL')?.trim() ||
      this.config.get<string>('ADMIN_USERNAME')?.trim() ||
      'admin@api-open.local'
    ).toLowerCase();

    const cleanId = (identifier || '').trim().toLowerCase();
    const cleanPass = password || '';

    const idOk = this.safeEqual(cleanId, expectedEmail);
    const passOk = this.safeEqual(cleanPass, expectedPass);

    if (!idOk || !passOk) {
      this.recordFailure(clientKey);
      throw new UnauthorizedException('Invalid admin credentials');
    }

    this.failedAttempts.delete(clientKey);
    const now = Date.now();
    const payload: AdminTokenPayload = {
      sub: expectedEmail,
      role: 'superadmin',
      iat: now,
      exp: now + 12 * 60 * 60 * 1000,
    };

    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64url',
    );
    const sig = crypto
      .createHmac('sha256', this.getSigningSecret())
      .update(encoded)
      .digest('base64url');

    return {
      token: `${encoded}.${sig}`,
      admin: {
        email: expectedEmail,
        role: 'superadmin',
        expiresAt: new Date(payload.exp).toISOString(),
      },
    };
  }

  verifyToken(token: string): AdminTokenPayload {
    if (!token || !token.includes('.')) {
      throw new UnauthorizedException('Missing or invalid admin token');
    }
    const [encoded, sig] = token.split('.');
    if (!encoded || !sig) {
      throw new UnauthorizedException('Malformed admin token');
    }

    const expectedSig = crypto
      .createHmac('sha256', this.getSigningSecret())
      .update(encoded)
      .digest('base64url');

    if (!this.safeEqual(sig, expectedSig)) {
      throw new UnauthorizedException('Invalid admin token signature');
    }

    let payload: AdminTokenPayload;
    try {
      payload = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      ) as AdminTokenPayload;
    } catch {
      throw new UnauthorizedException('Corrupt admin token payload');
    }

    if (!payload.exp || payload.exp < Date.now()) {
      throw new UnauthorizedException('Admin session expired');
    }

    return payload;
  }

  async getOverview() {
    const dbStart = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - dbStart;

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      users,
      personalWorkspaces,
      teamWorkspaces,
      workspaceMembers,
      collections,
      collectionSnapshots,
      apiRequests,
      environments,
      requestHistories,
      activityLogs,
      emailLogsSent,
      emailLogsFailed,
      requestComments,
      monitorsEnabled,
      monitorsDisabled,
      histories24h,
      failedHistories24h,
      emails24h,
      methodGroups,
      recentHistories,
      recentActivities,
      recentEmails,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.workspace.count({ where: { type: WorkspaceType.PERSONAL } }),
      this.prisma.workspace.count({ where: { type: WorkspaceType.TEAM } }),
      this.prisma.workspaceMember.count(),
      this.prisma.collection.count(),
      this.prisma.collectionSnapshot.count(),
      this.prisma.apiRequest.count(),
      this.prisma.environment.count(),
      this.prisma.requestHistory.count(),
      this.prisma.activityLog.count(),
      this.prisma.emailLog.count({ where: { status: 'sent' } }),
      this.prisma.emailLog.count({ where: { status: 'failed' } }),
      this.prisma.requestComment.count(),
      this.prisma.monitor.count({ where: { enabled: true } }),
      this.prisma.monitor.count({ where: { enabled: false } }),
      this.prisma.requestHistory.count({
        where: { createdAt: { gte: since24h } },
      }),
      this.prisma.requestHistory.count({
        where: {
          createdAt: { gte: since24h },
          OR: [{ statusCode: { gte: 400 } }, { statusCode: null }],
        },
      }),
      this.prisma.emailLog.count({ where: { createdAt: { gte: since24h } } }),
      this.prisma.apiRequest.groupBy({
        by: ['method'],
        _count: { _all: true },
      }),
      this.prisma.requestHistory.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { email: true, name: true } },
          workspace: { select: { name: true } },
        },
      }),
      this.prisma.activityLog.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { email: true } },
          workspace: { select: { name: true } },
        },
      }),
      this.prisma.emailLog.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const avgLatencyAgg = await this.prisma.requestHistory.aggregate({
      where: { createdAt: { gte: since24h }, durationMs: { not: null } },
      _avg: { durationMs: true },
    });

    const mem = process.memoryUsage();

    return {
      counts: {
        users,
        workspaces: personalWorkspaces + teamWorkspaces,
        personalWorkspaces,
        teamWorkspaces,
        workspaceMembers,
        collections,
        collectionSnapshots,
        apiRequests,
        environments,
        requestHistories,
        activityLogs,
        emailLogs: emailLogsSent + emailLogsFailed,
        emailLogsSent,
        emailLogsFailed,
        requestComments,
        monitors: monitorsEnabled + monitorsDisabled,
        monitorsEnabled,
        monitorsDisabled,
      },
      traffic24h: {
        requests: histories24h,
        failedRequests: failedHistories24h,
        avgDurationMs: Math.round(avgLatencyAgg._avg.durationMs ?? 0),
        emails: emails24h,
      },
      requestsByMethod: methodGroups.map((g) => ({
        method: g.method,
        count: g._count._all,
      })),
      system: {
        dbStatus: 'connected',
        dbLatencyMs,
        nodeVersion: process.version,
        platform: process.platform,
        uptimeSeconds: Math.round(process.uptime()),
        memoryMb: {
          rss: Math.round(mem.rss / 1048576),
          heapUsed: Math.round(mem.heapUsed / 1048576),
          heapTotal: Math.round(mem.heapTotal / 1048576),
        },
        integrations: {
          supabaseUrl: Boolean(this.config.get<string>('SUPABASE_URL')?.trim()),
          supabaseServiceRole: Boolean(
            this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY')?.trim(),
          ),
          smtpConfigured: Boolean(
            this.config.get<string>('SMTP_HOST')?.trim() &&
              this.config.get<string>('SMTP_USER')?.trim(),
          ),
          adminPasswordConfigured: Boolean(
            this.config.get<string>('ADMIN_PASSWORD')?.trim(),
          ),
          adminCustomSecret: Boolean(
            this.config.get<string>('ADMIN_JWT_SECRET')?.trim(),
          ),
        },
      },
      recentHistories,
      recentActivities,
      recentEmails,
    };
  }

  async listUsers(q = '', limit = 100) {
    const clean = q.trim();
    return this.prisma.user.findMany({
      where: clean
        ? {
            OR: [
              { email: { contains: clean, mode: 'insensitive' } },
              { name: { contains: clean, mode: 'insensitive' } },
            ],
          }
        : undefined,
      take: Math.min(200, Math.max(1, limit)),
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            memberships: true,
            histories: true,
            activityLogs: true,
            comments: true,
          },
        },
      },
    });
  }

  async deleteUser(userId: string) {
    const supabaseUrl = this.config.get<string>('SUPABASE_URL')?.trim();
    const serviceRoleKey = this.config
      .get<string>('SUPABASE_SERVICE_ROLE_KEY')
      ?.trim();

    if (supabaseUrl && serviceRoleKey) {
      await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }).catch(() => undefined);
    }

    await this.prisma.user.delete({ where: { id: userId } });
    return { deleted: true, id: userId };
  }

  async listWorkspaces(q = '', type?: string, limit = 100) {
    const clean = q.trim();
    const validType =
      type === WorkspaceType.PERSONAL || type === WorkspaceType.TEAM
        ? (type as WorkspaceType)
        : undefined;
    return this.prisma.workspace.findMany({
      where: {
        ...(validType ? { type: validType } : {}),
        ...(clean ? { name: { contains: clean, mode: 'insensitive' } } : {}),
      },
      take: Math.min(200, Math.max(1, limit)),
      orderBy: { updatedAt: 'desc' },
      include: {
        members: {
          include: { user: { select: { email: true, name: true } } },
        },
        _count: {
          select: {
            collections: true,
            environments: true,
            histories: true,
            monitors: true,
          },
        },
      },
    });
  }

  async deleteWorkspace(id: string) {
    await this.prisma.workspace.delete({ where: { id } });
    return { deleted: true, id };
  }

  async listCollections(q = '', limit = 100) {
    const clean = q.trim();
    return this.prisma.collection.findMany({
      where: clean
        ? { name: { contains: clean, mode: 'insensitive' } }
        : undefined,
      take: Math.min(200, Math.max(1, limit)),
      orderBy: { updatedAt: 'desc' },
      include: {
        workspace: { select: { id: true, name: true } },
        parent: { select: { id: true, name: true } },
        _count: { select: { requests: true, children: true, snapshots: true } },
      },
    });
  }

  async listRequests(q = '', method?: string, limit = 100) {
    const clean = q.trim();
    const validMethod = Object.values(HttpMethod).includes(method as HttpMethod)
      ? (method as HttpMethod)
      : undefined;
    return this.prisma.apiRequest.findMany({
      where: {
        ...(validMethod ? { method: validMethod } : {}),
        ...(clean
          ? {
              OR: [
                { name: { contains: clean, mode: 'insensitive' } },
                { url: { contains: clean, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      take: Math.min(200, Math.max(1, limit)),
      orderBy: { updatedAt: 'desc' },
      include: {
        collection: {
          select: {
            id: true,
            name: true,
            workspace: { select: { id: true, name: true } },
          },
        },
        _count: { select: { comments: true } },
      },
    });
  }

  async listHistories(
    q = '',
    method?: string,
    statusGroup?: string,
    limit = 120,
  ) {
    const clean = q.trim();
    const validMethod = Object.values(HttpMethod).includes(method as HttpMethod)
      ? (method as HttpMethod)
      : undefined;
    const statusFilter =
      statusGroup === '2xx'
        ? { statusCode: { gte: 200, lt: 300 } }
        : statusGroup === '4xx'
          ? { statusCode: { gte: 400, lt: 500 } }
          : statusGroup === '5xx'
            ? { statusCode: { gte: 500 } }
            : statusGroup === 'error'
              ? { OR: [{ statusCode: { gte: 400 } }, { statusCode: null }] }
              : {};

    return this.prisma.requestHistory.findMany({
      where: {
        ...(validMethod ? { method: validMethod } : {}),
        ...statusFilter,
        ...(clean ? { url: { contains: clean, mode: 'insensitive' } } : {}),
      },
      take: Math.min(250, Math.max(1, limit)),
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { email: true, name: true } },
        workspace: { select: { name: true } },
      },
    });
  }

  async listActivities(q = '', type?: string, limit = 120) {
    const clean = q.trim();
    return this.prisma.activityLog.findMany({
      where: {
        ...(type ? { type } : {}),
        ...(clean
          ? {
              OR: [
                { message: { contains: clean, mode: 'insensitive' } },
                { url: { contains: clean, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      take: Math.min(250, Math.max(1, limit)),
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { email: true, name: true } },
        workspace: { select: { name: true } },
      },
    });
  }

  async listEmails(q = '', category?: string, status?: string, limit = 120) {
    const clean = q.trim();
    return this.prisma.emailLog.findMany({
      where: {
        ...(category ? { category } : {}),
        ...(status ? { status } : {}),
        ...(clean
          ? {
              OR: [
                { to: { contains: clean, mode: 'insensitive' } },
                { subject: { contains: clean, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      take: Math.min(250, Math.max(1, limit)),
      orderBy: { createdAt: 'desc' },
    });
  }

  async listMonitors(q = '', limit = 100) {
    const clean = q.trim();
    return this.prisma.monitor.findMany({
      where: clean
        ? { name: { contains: clean, mode: 'insensitive' } }
        : undefined,
      take: Math.min(200, Math.max(1, limit)),
      orderBy: { updatedAt: 'desc' },
      include: {
        workspace: { select: { id: true, name: true } },
      },
    });
  }

  async toggleMonitor(id: string) {
    const existing = await this.prisma.monitor.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('Monitor not found');
    return this.prisma.monitor.update({
      where: { id },
      data: { enabled: !existing.enabled },
      include: { workspace: { select: { id: true, name: true } } },
    });
  }

  async listEnvironments(q = '', limit = 100) {
    const clean = q.trim();
    return this.prisma.environment.findMany({
      where: clean
        ? { name: { contains: clean, mode: 'insensitive' } }
        : undefined,
      take: Math.min(200, Math.max(1, limit)),
      orderBy: { updatedAt: 'desc' },
      include: {
        workspace: { select: { id: true, name: true } },
      },
    });
  }

  async listComments(q = '', limit = 100) {
    const clean = q.trim();
    return this.prisma.requestComment.findMany({
      where: clean
        ? { content: { contains: clean, mode: 'insensitive' } }
        : undefined,
      take: Math.min(200, Math.max(1, limit)),
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { email: true, name: true } },
        request: { select: { id: true, name: true, method: true, url: true } },
      },
    });
  }

  async deleteComment(id: string) {
    await this.prisma.requestComment.delete({ where: { id } });
    return { deleted: true, id };
  }

  async listSnapshots(q = '', limit = 100) {
    const clean = q.trim();
    return this.prisma.collectionSnapshot.findMany({
      where: clean
        ? {
            OR: [
              { version: { contains: clean, mode: 'insensitive' } },
              { note: { contains: clean, mode: 'insensitive' } },
            ],
          }
        : undefined,
      take: Math.min(200, Math.max(1, limit)),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        collectionId: true,
        version: true,
        note: true,
        createdAt: true,
        collection: {
          select: {
            id: true,
            name: true,
            workspace: { select: { id: true, name: true } },
          },
        },
      },
    });
  }
}
