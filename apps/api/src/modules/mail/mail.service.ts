import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly mailerService: MailerService,
    private readonly prisma: PrismaService,
  ) {}

  async sendEmail(options: {
    to: string;
    subject: string;
    text?: string;
    html?: string;
    userId?: string;
    workspaceId?: string;
    category?: string;
  }) {
    try {
      await this.mailerService.sendMail({
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });
      await this.saveEmailLog({
        userId: options.userId,
        workspaceId: options.workspaceId,
        to: options.to,
        subject: options.subject,
        category: options.category ?? 'general',
        status: 'sent',
      });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown mail error';
      this.logger.error(`Failed to send email to ${options.to}: ${message}`);
      await this.saveEmailLog({
        userId: options.userId,
        workspaceId: options.workspaceId,
        to: options.to,
        subject: options.subject,
        category: options.category ?? 'general',
        status: 'failed',
        error: message,
      });
      return { success: false, error: message };
    }
  }

  async saveEmailLog(entry: {
    userId?: string;
    workspaceId?: string;
    to: string;
    subject: string;
    category?: string;
    status: 'sent' | 'failed';
    error?: string;
  }) {
    try {
      return await this.prisma.emailLog.create({
        data: {
          userId: entry.userId || null,
          workspaceId: entry.workspaceId || null,
          to: entry.to.trim().toLowerCase(),
          subject: entry.subject,
          category: entry.category || 'general',
          status: entry.status,
          error: entry.error || null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Could not persist email log: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      return null;
    }
  }
}
