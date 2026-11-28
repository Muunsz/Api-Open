import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminService, type AdminTokenPayload } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('login')
  login(
    @Body() body: { email?: string; username?: string; password?: string },
    @Req() req: Request,
  ) {
    const clientIp =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0] ||
      req.ip ||
      'unknown';
    return this.adminService.login(
      body.email || body.username || '',
      body.password || '',
      clientIp,
    );
  }

  @UseGuards(AdminAuthGuard)
  @Get('me')
  me(@Req() req: Request & { admin?: AdminTokenPayload }) {
    return { ok: true, admin: req.admin };
  }

  @UseGuards(AdminAuthGuard)
  @Get('overview')
  overview() {
    return this.adminService.getOverview();
  }

  @UseGuards(AdminAuthGuard)
  @Get('users')
  users(@Query('q') q?: string, @Query('limit') limit?: string) {
    return this.adminService.listUsers(q, limit ? Number(limit) : 100);
  }

  @UseGuards(AdminAuthGuard)
  @Delete('users/:id')
  deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  @UseGuards(AdminAuthGuard)
  @Get('workspaces')
  workspaces(
    @Query('q') q?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listWorkspaces(q, type, limit ? Number(limit) : 100);
  }

  @UseGuards(AdminAuthGuard)
  @Delete('workspaces/:id')
  deleteWorkspace(@Param('id') id: string) {
    return this.adminService.deleteWorkspace(id);
  }

  @UseGuards(AdminAuthGuard)
  @Get('collections')
  collections(@Query('q') q?: string, @Query('limit') limit?: string) {
    return this.adminService.listCollections(q, limit ? Number(limit) : 100);
  }

  @UseGuards(AdminAuthGuard)
  @Get('requests')
  requests(
    @Query('q') q?: string,
    @Query('method') method?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listRequests(q, method, limit ? Number(limit) : 100);
  }

  @UseGuards(AdminAuthGuard)
  @Get('histories')
  histories(
    @Query('q') q?: string,
    @Query('method') method?: string,
    @Query('statusGroup') statusGroup?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listHistories(
      q,
      method,
      statusGroup,
      limit ? Number(limit) : 120,
    );
  }

  @UseGuards(AdminAuthGuard)
  @Get('activities')
  activities(
    @Query('q') q?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listActivities(q, type, limit ? Number(limit) : 120);
  }

  @UseGuards(AdminAuthGuard)
  @Get('emails')
  emails(
    @Query('q') q?: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listEmails(
      q,
      category,
      status,
      limit ? Number(limit) : 120,
    );
  }

  @UseGuards(AdminAuthGuard)
  @Get('monitors')
  monitors(@Query('q') q?: string, @Query('limit') limit?: string) {
    return this.adminService.listMonitors(q, limit ? Number(limit) : 100);
  }

  @UseGuards(AdminAuthGuard)
  @Patch('monitors/:id/toggle')
  toggleMonitor(@Param('id') id: string) {
    return this.adminService.toggleMonitor(id);
  }

  @UseGuards(AdminAuthGuard)
  @Get('environments')
  environments(@Query('q') q?: string, @Query('limit') limit?: string) {
    return this.adminService.listEnvironments(q, limit ? Number(limit) : 100);
  }

  @UseGuards(AdminAuthGuard)
  @Get('comments')
  comments(@Query('q') q?: string, @Query('limit') limit?: string) {
    return this.adminService.listComments(q, limit ? Number(limit) : 100);
  }

  @UseGuards(AdminAuthGuard)
  @Delete('comments/:id')
  deleteComment(@Param('id') id: string) {
    return this.adminService.deleteComment(id);
  }

  @UseGuards(AdminAuthGuard)
  @Get('snapshots')
  snapshots(@Query('q') q?: string, @Query('limit') limit?: string) {
    return this.adminService.listSnapshots(q, limit ? Number(limit) : 100);
  }
}
