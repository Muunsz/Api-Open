import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';

@Global()
@Module({
  imports: [
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const port = Number(config.get('SMTP_PORT') ?? 465);
        const host = config.get<string>('SMTP_HOST') || 'smtp.gmail.com';
        const rawPass = config.get<string>('SMTP_PASS') || '';
        const pass = host.includes('gmail')
          ? rawPass.replace(/\s+/g, '')
          : rawPass.trim();
        return {
          transport: {
            host,
            port,
            secure: port === 465,
            auth: {
              user: (config.get<string>('SMTP_USER') || '').trim(),
              pass,
            },
          },
          defaults: {
            from:
              config.get<string>('SMTP_FROM') ||
              `"Api-Open" <${config.get<string>('SMTP_USER') || 'noreply@api-open.local'}>`,
          },
        };
      },
    }),
  ],
  controllers: [MailController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
