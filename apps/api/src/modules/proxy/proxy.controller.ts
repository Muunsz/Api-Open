import {
  All,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type {
  ProxyExecuteRequest,
  ProxyExecuteResponse,
} from '@api-open/shared';
import { ProxyService } from './proxy.service';

@Controller('proxy')
export class ProxyController {
  constructor(private readonly proxyService: ProxyService) {}

  @Get('image')
  async proxyImage(@Query('url') url: string, @Res() res: Response) {
    const { buffer, contentType } = await this.proxyService.fetchImage(url);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.send(buffer);
  }

  @Post('execute')
  execute(@Body() body: ProxyExecuteRequest): Promise<ProxyExecuteResponse> {
    return this.proxyService.execute(body);
  }

  @Post('fetch-spec')
  fetchSpec(
    @Body('url') url: string,
  ): Promise<{ content: string; contentType: string }> {
    return this.proxyService.fetchSpecText(url);
  }

  @Post('git-import')
  gitImport(
    @Body() body: { repoUrl: string; branch?: string; path?: string },
  ): Promise<{ files: Array<{ path: string; name: string; content: string }> }> {
    return this.proxyService.importFromGitRepo(
      body.repoUrl,
      body.branch,
      body.path,
    );
  }

  @Post('grpc')
  executeGrpc(
    @Body()
    body: {
      target: string;
      service: string;
      method: string;
      protoText: string;
      payloadJson: string;
      useTls?: boolean;
    },
  ): Promise<{ statusCode: number; durationMs: number; body: string }> {
    return this.proxyService.executeNativeGrpc(body);
  }

  @Post('grpc-reflect')
  reflectGrpc(
    @Body() body: { target: string; useTls?: boolean },
  ): Promise<{
    services: string[];
    methods: Array<{ service: string; name: string }>;
    protoText: string;
  }> {
    return this.proxyService.reflectGrpcServer(body);
  }

  @Post('db-query')
  runDbQuery(
    @Body() body: { connectionUrl?: string; sql: string },
  ): Promise<{ rows: unknown[]; durationMs: number }> {
    return this.proxyService.executeDbQuery(body.connectionUrl, body.sql);
  }

  @Get('record/:sessionId')
  getRecorded(@Param('sessionId') sessionId: string) {
    return this.proxyService.getRecordedTraffic(sessionId);
  }

  @All('webhook/:binId')
  captureWebhook(@Param('binId') binId: string, @Req() req: Request) {
    return this.proxyService.captureWebhookEvent(binId, req);
  }

  @Get('webhook/:binId/events')
  getWebhookEvents(@Param('binId') binId: string) {
    return this.proxyService.getWebhookEvents(binId);
  }

  @Delete('webhook/:binId/events')
  clearWebhookEvents(@Param('binId') binId: string) {
    return this.proxyService.clearWebhookEvents(binId);
  }

  @Delete('record/:sessionId')
  clearRecorded(@Param('sessionId') sessionId: string) {
    return this.proxyService.clearRecordedTraffic(sessionId);
  }

  @All('record/:sessionId/*path')
  async recordAndForward(
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await this.proxyService.recordAndForward(sessionId, req);
    for (const [k, v] of Object.entries(result.headers)) {
      const lk = k.toLowerCase();
      if (lk !== 'content-length' && lk !== 'transfer-encoding') {
        res.setHeader(k, v);
      }
    }
    return res.status(result.statusCode).send(result.body);
  }
}
