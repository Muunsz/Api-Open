import {
  Body,
  Controller,
  Delete,
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
}
