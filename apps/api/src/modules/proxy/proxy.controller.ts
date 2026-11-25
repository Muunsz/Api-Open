import { Body, Controller, Post } from '@nestjs/common';
import type {
  ProxyExecuteRequest,
  ProxyExecuteResponse,
} from '@api-open/shared';
import { ProxyService } from './proxy.service';

@Controller('proxy')
export class ProxyController {
  constructor(private readonly proxyService: ProxyService) {}

  @Post('execute')
  execute(@Body() body: ProxyExecuteRequest): Promise<ProxyExecuteResponse> {
    return this.proxyService.execute(body);
  }
}
