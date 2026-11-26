function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderEmailShell(options: {
  preheader: string;
  badge: string;
  badgeColor?: string;
  badgeBg?: string;
  title: string;
  subtitle: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  footerNote: string;
}): string {
  const badgeColor = options.badgeColor ?? '#1d4ed8';
  const badgeBg = options.badgeBg ?? '#dbeafe';
  const safeUrl = escapeHtml(options.ctaUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(options.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${escapeHtml(options.preheader)}
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f1f5f9;padding:36px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.06);">
          <!-- Top Accent Bar -->
          <tr>
            <td style="height:5px;background:linear-gradient(90deg,#2563eb 0%,#4f46e5 50%,#0ea5e9 100%);font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <!-- Brand Header -->
          <tr>
            <td style="padding:28px 32px 16px 32px;border-bottom:1px solid #f1f5f9;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <span style="display:inline-block;padding:6px 12px;background-color:#0f172a;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.4px;border-radius:8px;">
                      { } API-OPEN
                    </span>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span style="display:inline-block;padding:4px 10px;background-color:${badgeBg};color:${badgeColor};font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;border-radius:999px;">
                      ${escapeHtml(options.badge)}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Main Content -->
          <tr>
            <td style="padding:28px 32px 12px 32px;">
              <h1 style="margin:0 0 8px 0;font-size:22px;line-height:1.3;font-weight:700;color:#0f172a;">
                ${escapeHtml(options.title)}
              </h1>
              <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#475569;">
                ${escapeHtml(options.subtitle)}
              </p>
              ${options.bodyHtml}
            </td>
          </tr>
          <!-- CTA Button -->
          <tr>
            <td style="padding:12px 32px 24px 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" style="border-radius:8px;background-color:#2563eb;">
                    <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
                      ${escapeHtml(options.ctaLabel)}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Fallback URL -->
          <tr>
            <td style="padding:0 32px 28px 32px;">
              <div style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;">
                <p style="margin:0 0 4px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;">
                  Or copy and open this link
                </p>
                <p style="margin:0;font-size:12px;line-height:1.5;color:#2563eb;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">
                  ${safeUrl}
                </p>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:18px 32px;background-color:#f8fafc;border-top:1px solid #e2e8f0;">
              <p style="margin:0 0 6px 0;font-size:12px;line-height:1.5;color:#64748b;">
                ${escapeHtml(options.footerNote)}
              </p>
              <p style="margin:0;font-size:11px;color:#94a3b8;">
                Api-Open &bull; Collaborative API Testing &amp; Workspace Platform
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function renderWorkspaceInviteEmail(params: {
  inviterLabel: string;
  workspaceName: string;
  role: string;
  recipientEmail: string;
  appUrl: string;
}) {
  const safeInviter = escapeHtml(params.inviterLabel);
  const safeWorkspace = escapeHtml(params.workspaceName);
  const safeRole = escapeHtml(params.role);
  const safeEmail = escapeHtml(params.recipientEmail);

  const roleColor =
    params.role === 'OWNER'
      ? '#b45309'
      : params.role === 'EDITOR'
        ? '#047857'
        : '#475569';
  const roleBg =
    params.role === 'OWNER'
      ? '#fef3c7'
      : params.role === 'EDITOR'
        ? '#d1fae5'
        : '#f1f5f9';

  const bodyHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:16px;">
      <tr>
        <td style="padding:16px 18px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding:4px 0;font-size:12px;color:#64748b;width:110px;">Workspace</td>
              <td style="padding:4px 0;font-size:13px;font-weight:600;color:#0f172a;">${safeWorkspace}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;font-size:12px;color:#64748b;">Invited by</td>
              <td style="padding:4px 0;font-size:13px;font-weight:500;color:#0f172a;">${safeInviter}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;font-size:12px;color:#64748b;">Assigned Role</td>
              <td style="padding:4px 0;">
                <span style="display:inline-block;padding:2px 9px;background-color:${roleBg};color:${roleColor};font-size:11px;font-weight:700;border-radius:999px;">
                  ${safeRole}
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:4px 0;font-size:12px;color:#64748b;">Account</td>
              <td style="padding:4px 0;font-size:13px;color:#334155;">${safeEmail}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#475569;">
      Sign in or register using <strong>${safeEmail}</strong> to start collaborating on collections, environments, and API tests.
    </p>
  `;

  return {
    subject: `Invitation to join "${params.workspaceName}" on Api-Open`,
    text: `${params.inviterLabel} invited you as ${params.role} to workspace "${params.workspaceName}" on Api-Open. Open ${params.appUrl} and sign in with ${params.recipientEmail} to access it.`,
    html: renderEmailShell({
      preheader: `${params.inviterLabel} invited you to collaborate in ${params.workspaceName} on Api-Open.`,
      badge: 'Workspace Invite',
      title: `You're invited to ${params.workspaceName}`,
      subtitle: `${params.inviterLabel} invited you to collaborate together in Api-Open.`,
      bodyHtml,
      ctaLabel: 'Open Api-Open Workspace',
      ctaUrl: params.appUrl,
      footerNote: `This invitation was sent to ${params.recipientEmail}. If you did not expect it, you can safely ignore this email.`,
    }),
  };
}

export function renderPasswordResetEmail(params: {
  recipientEmail: string;
  resetUrl: string;
}) {
  const safeEmail = escapeHtml(params.recipientEmail);

  const bodyHtml = `
    <div style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 16px;margin-bottom:16px;">
      <p style="margin:0;font-size:13px;line-height:1.55;color:#92400e;">
        <strong>Security Notice:</strong> This password reset link is valid for a limited time and can only be used once for <strong>${safeEmail}</strong>.
      </p>
    </div>
    <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#475569;">
      Click the button below to choose a new password for your Api-Open account.
    </p>
  `;

  return {
    subject: 'Reset your Api-Open password',
    text: `We received a request to reset the password for ${params.recipientEmail} on Api-Open. Open this link to set a new password: ${params.resetUrl}`,
    html: renderEmailShell({
      preheader: 'Reset your Api-Open account password securely.',
      badge: 'Password Reset',
      badgeColor: '#b45309',
      badgeBg: '#fef3c7',
      title: 'Reset your password',
      subtitle: `We received a request to reset the password for ${params.recipientEmail}.`,
      bodyHtml,
      ctaLabel: 'Reset Password',
      ctaUrl: params.resetUrl,
      footerNote:
        'If you did not request a password reset, no action is needed and your current password will remain unchanged.',
    }),
  };
}
