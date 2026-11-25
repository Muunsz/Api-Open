import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly mailerService: MailerService) {}

  async sendEmail(options: {
    to: string;
    subject: string;
    text?: string;
    html?: string;
  }) {
    try {
      await this.mailerService.sendMail({
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown mail error';
      this.logger.error(`Failed to send email to ${options.to}: ${message}`);
      return { success: false, error: message };
    }
  }
}
