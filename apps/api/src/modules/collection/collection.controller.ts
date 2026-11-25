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
import { CollectionService } from './collection.service';

@Controller()
@UseGuards(SupabaseAuthGuard)
export class CollectionController {
  constructor(private readonly collectionService: CollectionService) {}

  @Get('workspaces/:workspaceId/collections')
  list(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.collectionService.listByWorkspace(workspaceId, user.id);
  }

  @Post('workspaces/:workspaceId/collections')
  create(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { name: string; parentId?: string },
  ) {
    return this.collectionService.create(workspaceId, user.id, {
      name: body.name || 'New Collection',
      parentId: body.parentId,
    });
  }

  @Patch('collections/:id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { name?: string; parentId?: string | null; order?: number },
  ) {
    return this.collectionService.update(id, user.id, body);
  }

  @Delete('collections/:id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.collectionService.remove(id, user.id);
  }
}
