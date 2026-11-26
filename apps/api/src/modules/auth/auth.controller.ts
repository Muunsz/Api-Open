import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { renderPasswordResetEmail } from '../mail/email-templates';
import { MailService } from '../mail/mail.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly config: ConfigService,
    private readonly mailService: MailService,
  ) {}

  @Post('reset-password')
  async requestPasswordReset(
    @Body() body: { email?: string; redirectTo?: string },
  ) {
    const email = body.email?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Valid email address is required');
    }

    const supabaseUrl = this.config.get<string>('SUPABASE_URL')?.trim();
    const serviceRoleKey = this.config
      .get<string>('SUPABASE_SERVICE_ROLE_KEY')
      ?.trim();
    const anonKey =
      this.config.get<string>('SUPABASE_ANON_KEY')?.trim() ||
      this.config.get<string>('VITE_SUPABASE_ANON_KEY')?.trim();

    const defaultRedirect =
      this.config.get<string>('CORS_ORIGIN')?.split(',')[0]?.trim() ||
      'http://localhost:9999';
    const redirectTo = body.redirectTo?.trim() || defaultRedirect;

    // 1. Best path: generate official recovery link via Admin API & send branded HTML email
    if (supabaseUrl && serviceRoleKey) {
      const res = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          type: 'recovery',
          email,
          redirect_to: redirectTo,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new BadRequestException(
          `Failed to generate reset password link: ${errText}`,
        );
      }

      const payload = (await res.json()) as {
        action_link?: string;
        properties?: { action_link?: string };
      };
      const resetUrl =
        payload.action_link || payload.properties?.action_link || redirectTo;

      const rendered = renderPasswordResetEmail({
        recipientEmail: email,
        resetUrl,
      });

      const mailResult = await this.mailService.sendEmail({
        to: email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        category: 'auth_password_reset',
      });

      return {
        ok: mailResult.success,
        handled: true,
        mode: 'custom_smtp',
        email,
      };
    }

    // 2. Fallback path: trigger Supabase /auth/v1/recover from backend if anon key is available
    if (supabaseUrl && anonKey) {
      const recoverUrl = new URL(`${supabaseUrl}/auth/v1/recover`);
      recoverUrl.searchParams.set('redirect_to', redirectTo);

      const res = await fetch(recoverUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
        },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const errText = await res.text();
        await this.mailService.saveEmailLog({
          to: email,
          subject: 'Reset your Api-Open password',
          category: 'auth_password_reset',
          status: 'failed',
          error: errText,
        });
        throw new BadRequestException(
          `Failed to request password reset: ${errText}`,
        );
      }

      await this.mailService.saveEmailLog({
        to: email,
        subject: 'Reset your Api-Open password',
        category: 'auth_password_reset',
        status: 'sent',
      });

      return {
        ok: true,
        handled: true,
        mode: 'supabase_recover',
        email,
      };
    }

    // 3. Neither service-role nor anon key configured on API server: let frontend fallback handle Supabase recovery
    return {
      ok: true,
      handled: false,
      mode: 'client_fallback',
      email,
    };
  }
}
