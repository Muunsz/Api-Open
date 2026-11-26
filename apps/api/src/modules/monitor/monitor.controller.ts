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
import { CurrentUser } from '../auth/current-user.decorator';
import { type AuthUser, SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { MonitorService } from './monitor.service';

@Controller()
@UseGuards(SupabaseAuthGuard)
export class MonitorController {
  constructor(private readonly monitorService: MonitorService) {}

  @Get('workspaces/:workspaceId/monitors')
  list(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.monitorService.list(workspaceId, user.id);
  }

  @Post('workspaces/:workspaceId/monitors')
  create(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { collectionId: string; name: string; intervalMinutes?: number },
  ) {
    return this.monitorService.create(workspaceId, user.id, body);
  }

  @Patch('monitors/:id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { name?: string; intervalMinutes?: number; enabled?: boolean },
  ) {
    return this.monitorService.update(id, user.id, body);
  }

  @Post('monitors/:id/run')
  runNow(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.monitorService.runNow(id, user.id);
  }

  @Delete('monitors/:id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.monitorService.remove(id, user.id);
  }
}
