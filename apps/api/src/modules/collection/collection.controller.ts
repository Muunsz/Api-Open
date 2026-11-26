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
import {
  CollectionService,
  type SaveCollectionDto,
} from './collection.service';

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
    @Body() body: SaveCollectionDto,
  ) {
    return this.collectionService.create(workspaceId, user.id, {
      ...body,
      name: body.name || 'New Collection',
    });
  }

  @Patch('collections/:id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: SaveCollectionDto,
  ) {
    return this.collectionService.update(id, user.id, body);
  }

  @Post('collections/:id/duplicate')
  duplicate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.collectionService.duplicate(id, user.id);
  }

  @Delete('collections/:id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.collectionService.remove(id, user.id);
  }

  @Get('collections/:id/snapshots')
  listSnapshots(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.collectionService.listSnapshots(id, user.id);
  }

  @Post('collections/:id/snapshots')
  createSnapshot(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { version: string; note?: string },
  ) {
    return this.collectionService.createSnapshot(
      id,
      user.id,
      body.version,
      body.note,
    );
  }

  @Post('snapshots/:snapshotId/restore')
  restoreSnapshot(
    @Param('snapshotId') snapshotId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.collectionService.restoreSnapshot(snapshotId, user.id);
  }
}

@Controller('public')
export class PublicDocsController {
  constructor(private readonly collectionService: CollectionService) {}

  @Get('docs/:collectionId')
  getPublicDocs(@Param('collectionId') collectionId: string) {
    return this.collectionService.getPublicDocs(collectionId);
  }
}
