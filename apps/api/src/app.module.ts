import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { CollectionModule } from './modules/collection/collection.module';
import { EnvironmentModule } from './modules/environment/environment.module';
import { MailModule } from './modules/mail/mail.module';
import { ProxyModule } from './modules/proxy/proxy.module';
import { RequestModule } from './modules/request/request.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    MailModule,
    WorkspaceModule,
    CollectionModule,
    RequestModule,
    EnvironmentModule,
    ProxyModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
