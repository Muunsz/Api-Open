import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminService, type AdminTokenPayload } from './admin.service';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly adminService: AdminService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<
      Request & { admin?: AdminTokenPayload }
    >();
    const headerToken = req.headers['x-admin-token'];
    const authHeader = req.headers.authorization;
    const bearer =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : '';
    const token =
      typeof headerToken === 'string' && headerToken.trim()
        ? headerToken.trim()
        : bearer;

    if (!token) {
      throw new UnauthorizedException('Admin authentication required');
    }

    req.admin = this.adminService.verifyToken(token);
    return true;
  }
}
