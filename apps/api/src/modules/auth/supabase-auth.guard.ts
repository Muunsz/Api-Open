import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
}

interface JwkEntry {
  kid?: string;
  kty: string;
  alg?: string;
  [key: string]: unknown;
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private cachedJwks: { keys: JwkEntry[]; fetchedAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private getJwksUrl(): string {
    const jwksUrl =
      process.env.SUPABASE_JWKS_URL ||
      (process.env.SUPABASE_URL
        ? `${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`
        : '');
    if (!jwksUrl) {
      throw new UnauthorizedException('SUPABASE_JWKS_URL is not configured');
    }
    return jwksUrl;
  }

  private async fetchJwksKeys(force = false): Promise<JwkEntry[]> {
    const now = Date.now();
    if (!force && this.cachedJwks && now - this.cachedJwks.fetchedAt < 300_000) {
      return this.cachedJwks.keys;
    }
    const res = await fetch(this.getJwksUrl());
    if (!res.ok) {
      throw new Error(`Failed to fetch JWKS (${res.status})`);
    }
    const data = (await res.json()) as { keys?: JwkEntry[] };
    const keys = data.keys ?? [];
    this.cachedJwks = { keys, fetchedAt: now };
    return keys;
  }

  private async verifyJwtWithCrypto(token: string): Promise<Record<string, unknown>> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Malformed JWT');
    const [headerB64, payloadB64, sigB64] = parts;
    const header = JSON.parse(
      Buffer.from(headerB64, 'base64url').toString('utf8'),
    ) as { alg?: string; kid?: string };
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;

    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
      throw new Error('JWT expired');
    }

    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);
    const signature = Buffer.from(sigB64, 'base64url');
    const alg = header.alg ?? '';

    if (alg.startsWith('HS') && process.env.SUPABASE_JWT_SECRET) {
      const hashAlg = alg === 'HS512' ? 'sha512' : alg === 'HS384' ? 'sha384' : 'sha256';
      const expected = crypto
        .createHmac(hashAlg, process.env.SUPABASE_JWT_SECRET)
        .update(signingInput)
        .digest();
      if (
        expected.length !== signature.length ||
        !crypto.timingSafeEqual(expected, signature)
      ) {
        throw new Error('Invalid HS signature');
      }
      return payload;
    }

    let keys = await this.fetchJwksKeys(false);
    let jwk = header.kid ? keys.find((k) => k.kid === header.kid) : keys[0];
    if (!jwk) {
      keys = await this.fetchJwksKeys(true);
      jwk = header.kid ? keys.find((k) => k.kid === header.kid) : keys[0];
    }
    if (!jwk) throw new Error('Matching JWK not found');

    const keyObj = crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' });
    const hashAlg = alg.endsWith('512') ? 'sha512' : alg.endsWith('384') ? 'sha384' : 'sha256';
    const isEc = alg.startsWith('ES');
    const ok = crypto.verify(
      hashAlg,
      signingInput,
      isEc ? { key: keyObj, dsaEncoding: 'ieee-p1363' } : keyObj,
      signature,
    );
    if (!ok) throw new Error('Invalid asymmetric JWT signature');
    return payload;
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
      payload = await this.verifyJwtWithCrypto(token);
    } catch (err) {
      verifyErrMessage = err instanceof Error ? err.message : String(err);
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
