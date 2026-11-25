import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
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
}
