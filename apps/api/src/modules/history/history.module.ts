import { Module } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';

@Module({
  imports: [WorkspaceModule],
  controllers: [HistoryController],
  providers: [HistoryService],
})
export class HistoryModule {}
