export interface SecretFinding {
  location: string;
  pattern: string;
  preview: string;
}

const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'OpenAI / Stripe Secret Key', regex: /\b(sk-[a-zA-Z0-9]{20,})\b/g },
  { name: 'GitHub Token', regex: /\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g },
  { name: 'Google API Key', regex: /\b(AIza[0-9A-Za-z\-_]{30,})\b/g },
  { name: 'AWS Access Key ID', regex: /\b(AKIA[0-9A-Z]{16})\b/g },
  { name: 'JWT / Bearer Token', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'Private Key PEM', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

export function scanTextForSecrets(text: string, location: string): SecretFinding[] {
  if (!text) return [];
  const findings: SecretFinding[] = [];
  for (const rule of SECRET_PATTERNS) {
    rule.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.regex.exec(text)) !== null) {
      const raw = m[0];
      const preview = raw.length > 14 ? `${raw.slice(0, 6)}...${raw.slice(-4)}` : '***';
      findings.push({ location, pattern: rule.name, preview });
    }
  }
  return findings;
}

export function scanJsonPayloadForSecrets(jsonText: string, label = 'Collection'): SecretFinding[] {
  return scanTextForSecrets(jsonText, label);
}

export function redactSecretsInText(text: string): string {
  let out = text;
  for (const rule of SECRET_PATTERNS) {
    rule.regex.lastIndex = 0;
    out = out.replace(rule.regex, '[REDACTED_SECRET]');
  }
  return out;
}
