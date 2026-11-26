import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { createRemoteJWKSet } from 'jose';
import { PrismaService } from '../../prisma/prisma.service';

const loadJose = () =>
  Function('return import("jose")')() as Promise<typeof import('jose')>;

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async getJwks() {
    if (!this.jwks) {
      const jwksUrl =
        process.env.SUPABASE_JWKS_URL ||
        (process.env.SUPABASE_URL
          ? `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`
          : '');
      if (!jwksUrl) {
        throw new UnauthorizedException('SUPABASE_JWKS_URL is not configured');
      }
      const { createRemoteJWKSet } = await loadJose();
      this.jwks = createRemoteJWKSet(new URL(jwksUrl));
    }
    return this.jwks;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader: string | undefined = req.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer authorization token');
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException('Empty authorization token');
    }

    let payload: Record<string, unknown> | null = null;
    let verifyErrMessage = '';
    try {
      const { jwtVerify } = await loadJose();
      const verified = await jwtVerify(token, await this.getJwks());
      payload = verified.payload as Record<string, unknown>;
    } catch (err) {
      verifyErrMessage = err instanceof Error ? err.message : String(err);
    }

    if (!payload && process.env.SUPABASE_JWT_SECRET) {
      try {
        const { jwtVerify } = await loadJose();
        const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
        const verified = await jwtVerify(token, secret);
        payload = verified.payload as Record<string, unknown>;
      } catch (err) {
        verifyErrMessage = err instanceof Error ? err.message : String(err);
      }
    }

    if (!payload) {
      const supabaseUrl =
        process.env.SUPABASE_URL?.replace(/\/$/, '') ||
        (process.env.SUPABASE_JWKS_URL
          ? new URL(process.env.SUPABASE_JWKS_URL).origin
          : '');
      if (supabaseUrl) {
        try {
          const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: {
              Authorization: `Bearer ${token}`,
              ...(process.env.SUPABASE_ANON_KEY
                ? { apikey: process.env.SUPABASE_ANON_KEY }
                : {}),
            },
          });
          if (userRes.ok) {
            const u = (await userRes.json()) as {
              id?: string;
              email?: string;
              user_metadata?: Record<string, unknown>;
            };
            if (u.id && u.email) {
              payload = {
                sub: u.id,
                email: u.email,
                user_metadata: u.user_metadata ?? {},
              };
            }
          }
        } catch {
          // ignore fallback error
        }
      }
    }

    if (!payload) {
      throw new UnauthorizedException(
        verifyErrMessage
          ? `Invalid or expired Supabase token (${verifyErrMessage})`
          : 'Invalid or expired Supabase token',
      );
    }

    const userId = typeof payload.sub === 'string' ? payload.sub : '';
    const email = typeof payload.email === 'string' ? payload.email : '';
    if (!userId || !email) {
      throw new UnauthorizedException('Token missing sub or email claim');
    }

    const meta = (payload.user_metadata ?? {}) as Record<string, unknown>;
    const name =
      typeof meta.full_name === 'string'
        ? meta.full_name
        : typeof meta.name === 'string'
          ? meta.name
          : email.split('@')[0];
    const avatarUrl =
      typeof meta.avatar_url === 'string' ? meta.avatar_url : null;

    await this.prisma.user.upsert({
      where: { id: userId },
      update: { email },
      create: {
        id: userId,
        email,
        name,
        avatarUrl,
        memberships: {
          create: {
            role: 'OWNER',
            workspace: {
              create: {
                name: 'Personal Workspace',
                type: 'PERSONAL',
              },
            },
          },
        },
      },
    });

    req.user = { id: userId, email, name } satisfies AuthUser;
    return true;
  }
}
