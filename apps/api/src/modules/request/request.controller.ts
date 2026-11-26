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
import { RequestService, type SaveRequestDto } from './request.service';

@Controller()
@UseGuards(SupabaseAuthGuard)
export class RequestController {
  constructor(private readonly requestService: RequestService) {}

  @Post('collections/:collectionId/requests')
  create(
    @Param('collectionId') collectionId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: SaveRequestDto,
  ) {
    return this.requestService.create(collectionId, user.id, body);
  }

  @Patch('requests/:id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: SaveRequestDto,
  ) {
    return this.requestService.update(id, user.id, body);
  }

  @Delete('requests/:id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.requestService.remove(id, user.id);
  }

  @Get('requests/:id/comments')
  listComments(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.requestService.listComments(id, user.id);
  }

  @Post('requests/:id/comments')
  addComment(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body('content') content: string,
  ) {
    return this.requestService.addComment(id, user.id, content || '');
  }

  @Delete('comments/:commentId')
  deleteComment(
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.requestService.deleteComment(commentId, user.id);
  }
}
