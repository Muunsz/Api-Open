import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { type AuthUser, SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { WorkspaceService } from './workspace.service';

@Controller('workspaces')
@UseGuards(SupabaseAuthGuard)
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get('profile/me')
  getProfile(@CurrentUser() user: AuthUser) {
    return this.workspaceService.getProfile(user.id);
  }

  @Patch('profile/me')
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() body: { name?: string; avatarUrl?: string | null },
  ) {
    return this.workspaceService.updateProfile(user.id, body);
  }

  @Get('logs')
  listLogs(
    @CurrentUser() user: AuthUser,
    @Query('workspaceId') workspaceId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.workspaceService.listActivityLogs(
      user.id,
      workspaceId,
      limit ? Number(limit) : 100,
    );
  }

  @Post('logs')
  createLog(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      type: string;
      method?: string;
      url?: string;
      statusCode?: number;
      durationMs?: number;
      message: string;
      workspaceId?: string;
    },
  ) {
    return this.workspaceService.createActivityLog(user.id, body);
  }

  @Delete('logs')
  clearLogs(
    @CurrentUser() user: AuthUser,
    @Query('workspaceId') workspaceId?: string,
  ) {
    return this.workspaceService.clearActivityLogs(user.id, workspaceId);
  }

  @Get('email-logs')
  listEmailLogs(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
  ) {
    return this.workspaceService.listEmailLogs(
      user.id,
      user.email,
      limit ? Number(limit) : 100,
    );
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.workspaceService.listForUser(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body('name') name: string) {
    return this.workspaceService.createTeamWorkspace(
      user.id,
      name || 'Team Workspace',
    );
  }

  @Patch(':workspaceId')
  updateWorkspace(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { name?: string; summary?: string; readme?: string },
  ) {
    return this.workspaceService.updateWorkspace(workspaceId, user.id, body);
  }

  @Get(':workspaceId/members')
  listMembers(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workspaceService.listMembers(workspaceId, user.id);
  }

  @Post(':workspaceId/invite')
  invite(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { email: string; role?: WorkspaceRole },
  ) {
    return this.workspaceService.inviteMember(
      workspaceId,
      user.id,
      body.email,
      body.role ?? 'EDITOR',
    );
  }

  @Patch(':workspaceId/members/:memberId')
  updateMemberRole(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthUser,
    @Body('role') role: WorkspaceRole,
  ) {
    return this.workspaceService.updateMemberRole(
      workspaceId,
      user.id,
      memberId,
      role,
    );
  }

  @Delete(':workspaceId')
  deleteWorkspace(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workspaceService.deleteWorkspace(workspaceId, user.id);
  }

  @Delete(':workspaceId/members/:memberId')
  removeMember(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workspaceService.removeMember(workspaceId, user.id, memberId);
  }
}
