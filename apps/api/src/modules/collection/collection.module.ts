import { Module } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module';
import {
  CollectionController,
  PublicDocsController,
} from './collection.controller';
import { CollectionService } from './collection.service';

@Module({
  imports: [WorkspaceModule],
  controllers: [CollectionController, PublicDocsController],
  providers: [CollectionService],
})
export class CollectionModule {}
