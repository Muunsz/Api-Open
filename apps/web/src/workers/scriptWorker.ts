export interface ScriptRunInput {
  script: string;
  env: Record<string, string>;
  response?: {
    statusCode: number;
    statusText: string;
    durationMs: number;
    headers: Record<string, string>;
    body: string;
  };
}

export interface TestCaseResult {
  name: string;
  passed: boolean;
  error?: string;
}

export interface ScriptRunOutput {
  envUpdates: Record<string, string>;
  tests: TestCaseResult[];
  logs: string[];
  error?: string;
}

self.onmessage = (event: MessageEvent<ScriptRunInput>) => {
  const { script, env, response } = event.data;
  const envStore: Record<string, string> = { ...env };
  const envUpdates: Record<string, string> = {};
  const tests: TestCaseResult[] = [];
  const logs: string[] = [];

  const pm = {
    environment: {
      get(key: string): string | undefined {
        return envStore[key];
      },
      set(key: string, value: unknown) {
        const str = value === undefined || value === null ? '' : String(value);
        envStore[key] = str;
        envUpdates[key] = str;
      },
    },
    response: response
      ? {
          code: response.statusCode,
          status: response.statusText,
          responseTime: response.durationMs,
          headers: response.headers,
          text() {
            return response.body;
          },
          json() {
            return JSON.parse(response.body);
          },
        }
      : undefined,
    test(name: string, fn: () => void) {
      try {
        fn();
        tests.push({ name, passed: true });
      } catch (err) {
        tests.push({
          name,
          passed: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    expect(actual: unknown) {
      const assert = (cond: boolean, msg: string) => {
        if (!cond) throw new Error(msg);
      };
      return {
        to: {
          equal(expected: unknown) {
            assert(
              actual === expected,
              `Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`,
            );
          },
          eql(expected: unknown) {
            assert(
              JSON.stringify(actual) === JSON.stringify(expected),
              `Expected ${JSON.stringify(actual)} to deep equal ${JSON.stringify(expected)}`,
            );
          },
          include(item: unknown) {
            if (typeof actual === 'string') {
              assert(actual.includes(String(item)), `Expected "${actual}" to include "${item}"`);
            } else if (Array.isArray(actual)) {
              assert(actual.includes(item), `Expected array to include ${JSON.stringify(item)}`);
            } else {
              assert(false, 'expect().to.include() requires a string or array');
            }
          },
          be: {
            get ok() {
              assert(Boolean(actual), `Expected ${JSON.stringify(actual)} to be truthy`);
              return true;
            },
            a(typeName: string) {
              const actualType = Array.isArray(actual) ? 'array' : typeof actual;
              assert(
                actualType === typeName,
                `Expected ${actualType} to be a ${typeName}`,
              );
            },
          },
          have: {
            property(prop: string) {
              assert(
                actual !== null &&
                  typeof actual === 'object' &&
                  Object.prototype.hasOwnProperty.call(actual, prop),
                `Expected object to have property "${prop}"`,
              );
            },
          },
        },
      };
    },
  };

  const sandboxConsole = {
    log: (...args: unknown[]) =>
      logs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')),
    warn: (...args: unknown[]) =>
      logs.push('[warn] ' + args.map((a) => String(a)).join(' ')),
    error: (...args: unknown[]) =>
      logs.push('[error] ' + args.map((a) => String(a)).join(' ')),
  };

  try {
    const fn = new Function('pm', 'console', script);
    fn(pm, sandboxConsole);
    self.postMessage({ envUpdates, tests, logs } satisfies ScriptRunOutput);
  } catch (err) {
    self.postMessage({
      envUpdates,
      tests,
      logs,
      error: err instanceof Error ? err.message : String(err),
    } satisfies ScriptRunOutput);
  }
};
