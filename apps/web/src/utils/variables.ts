function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const SAMPLE_FIRST_NAMES = ['Ayu', 'Budi', 'Citra', 'Dimas', 'Eka', 'Farhan', 'Gita', 'Hadi', 'Indah', 'Joko'];
const SAMPLE_LAST_NAMES = ['Pratama', 'Saputra', 'Wijaya', 'Kusuma', 'Santoso', 'Nugroho', 'Lestari', 'Hidayat'];
const SAMPLE_WORDS = ['alpha', 'bravo', 'cobalt', 'delta', 'echo', 'falcon', 'horizon', 'nexus', 'orbit', 'pulse'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function resolveDynamicVariable(key: string): string | undefined {
  switch (key) {
    case '$timestamp':
      return String(Math.floor(Date.now() / 1000));
    case '$isoTimestamp':
      return new Date().toISOString();
    case '$guid':
    case '$uuid':
      return randomUuid();
    case '$randomInt':
      return String(Math.floor(Math.random() * 1001));
    case '$randomBoolean':
      return Math.random() < 0.5 ? 'true' : 'false';
    case '$randomFirstName':
      return pick(SAMPLE_FIRST_NAMES);
    case '$randomLastName':
      return pick(SAMPLE_LAST_NAMES);
    case '$randomFullName':
    case '$randomName':
      return `${pick(SAMPLE_FIRST_NAMES)} ${pick(SAMPLE_LAST_NAMES)}`;
    case '$randomUserName':
      return `${pick(SAMPLE_FIRST_NAMES).toLowerCase()}${Math.floor(Math.random() * 900 + 100)}`;
    case '$randomEmail':
      return `${pick(SAMPLE_FIRST_NAMES).toLowerCase()}.${pick(SAMPLE_LAST_NAMES).toLowerCase()}${Math.floor(Math.random() * 99)}@example.com`;
    case '$randomWord':
      return pick(SAMPLE_WORDS);
    case '$randomHexColor':
    case '$randomColor':
      return `#${Math.floor(Math.random() * 0xffffff)
        .toString(16)
        .padStart(6, '0')}`;
    case '$randomIP':
      return `${Math.floor(Math.random() * 223) + 1}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`;
    case '$randomUrl':
      return `https://api.${pick(SAMPLE_WORDS)}.example.com/v1`;
    default:
      return undefined;
  }
}

export function resolveVariables(
  input: string,
  variables: Record<string, string>,
): string {
  if (!input) return input;
  return input.replace(
    /\{\{\s*(\$?[a-zA-Z0-9_.-]+)\s*\}\}/g,
    (match, key: string) => {
      if (Object.prototype.hasOwnProperty.call(variables, key)) {
        return variables[key];
      }
      if (key.startsWith('$')) {
        const dyn = resolveDynamicVariable(key);
        if (dyn !== undefined) return dyn;
      }
      return match;
    },
  );
}
