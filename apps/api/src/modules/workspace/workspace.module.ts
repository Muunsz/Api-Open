import { Global, Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

@Global()
@Module({
  controllers: [WorkspaceController],
  providers: [WorkspaceService, SupabaseAuthGuard],
  exports: [WorkspaceService, SupabaseAuthGuard],
})
export class WorkspaceModule {}
