import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
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

  @Delete(':workspaceId/members/:memberId')
  removeMember(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workspaceService.removeMember(workspaceId, user.id, memberId);
  }
}
