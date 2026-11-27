export function unwrapStringifiedBody(raw?: string): string {
  if (!raw) return raw ?? '';
  let current = raw;
  for (let i = 0; i < 2; i++) {
    const trimmed = current.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'string') {
          current = parsed;
          continue;
        }
      } catch {
        break;
      }
    }
    break;
  }
  return current;
}
