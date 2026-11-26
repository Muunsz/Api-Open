import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { MailService } from './mail.service';

const ALLOWED_AUTH_CATEGORIES = new Set([
  'auth_verification',
  'auth_magic_link',
  'auth_password_reset',
]);

@Controller('mail')
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Post('auth-log')
  async logAuthEmail(
    @Body()
    body: {
      to: string;
      subject: string;
      category: string;
      status?: 'sent' | 'failed';
      error?: string;
    },
  ) {
    if (!body.to || !body.to.includes('@')) {
      throw new BadRequestException('Valid recipient email is required');
    }
    const category = ALLOWED_AUTH_CATEGORIES.has(body.category)
      ? body.category
      : 'auth_verification';

    return this.mailService.saveEmailLog({
      to: body.to,
      subject: body.subject || 'Supabase Auth Email',
      category,
      status: body.status === 'failed' ? 'failed' : 'sent',
      error: body.error,
    });
  }
}
