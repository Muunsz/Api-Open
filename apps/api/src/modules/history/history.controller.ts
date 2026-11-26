import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { HttpMethod, Prisma } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { type AuthUser, SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { HistoryService } from './history.service';

@Controller('workspaces/:workspaceId/history')
@UseGuards(SupabaseAuthGuard)
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get()
  list(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
  ) {
    return this.historyService.list(
      workspaceId,
      user.id,
      limit ? Number(limit) : 100,
    );
  }

  @Post()
  create(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      method: HttpMethod;
      url: string;
      statusCode?: number;
      durationMs?: number;
      requestSnapshot?: Prisma.InputJsonValue;
    },
  ) {
    return this.historyService.create(workspaceId, user.id, body);
  }

  @Delete()
  clear(@Param('workspaceId') workspaceId: string, @CurrentUser() user: AuthUser) {
    return this.historyService.clear(workspaceId, user.id);
  }
}
