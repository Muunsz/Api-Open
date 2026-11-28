import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express = require('express');
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

    const envOrigins = (process.env.CORS_ORIGIN ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const allowedOrigins = new Set([
      'https://api-open.vercel.app',
      'http://localhost:9999',
      'http://localhost:5173',
      ...envOrigins,
    ]);

    app.enableCors({
      origin: (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => {
        if (
          !origin ||
          origin === 'null' ||
          allowedOrigins.has('*') ||
          allowedOrigins.has(origin) ||
          /^https:\/\/api-open-[a-z0-9-]+\.vercel\.app$/i.test(origin)
        ) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
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
