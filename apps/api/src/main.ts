import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import * as express from 'express';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';

const server = express();
let initPromise: Promise<void> | null = null;

async function initApp(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const app = await NestFactory.create(AppModule, new ExpressAdapter(server));

    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );

    app.enableCors({
      origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:9999'],
      credentials: true,
    });

    await app.init();
  })();
  return initPromise;
}

if (!process.env.VERCEL) {
  initApp().then(() => {
    const port = process.env.PORT ?? 3000;
    server.listen(port);
  });
}

export default async function handler(req: Request, res: Response) {
  await initApp();
  server(req, res);
}
