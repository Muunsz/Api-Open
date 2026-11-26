import { Module } from '@nestjs/common';
import { ProxyModule } from '../proxy/proxy.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { MonitorController } from './monitor.controller';
import { MonitorService } from './monitor.service';

@Module({
  imports: [WorkspaceModule, ProxyModule],
  controllers: [MonitorController],
  providers: [MonitorService],
})
export class MonitorModule {}
