import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { EnvVariable } from '@api-open/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { type AuthUser, SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { EnvironmentService } from './environment.service';

@Controller()
@UseGuards(SupabaseAuthGuard)
export class EnvironmentController {
  constructor(private readonly environmentService: EnvironmentService) {}

  @Get('workspaces/:workspaceId/environments')
  list(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.environmentService.listByWorkspace(workspaceId, user.id);
  }

  @Post('workspaces/:workspaceId/environments')
  create(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { name: string; isGlobal?: boolean; variables?: EnvVariable[] },
  ) {
    return this.environmentService.create(workspaceId, user.id, {
      name: body.name || 'New Environment',
      isGlobal: body.isGlobal,
      variables: body.variables,
    });
  }

  @Patch('environments/:id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { name?: string; variables?: EnvVariable[] },
  ) {
    return this.environmentService.update(id, user.id, body);
  }

  @Delete('environments/:id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.environmentService.remove(id, user.id);
  }
}
