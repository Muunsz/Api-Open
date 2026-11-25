import type {
  ScriptRunInput,
  ScriptRunOutput,
} from '../workers/scriptWorker';

export type { ScriptRunOutput, TestCaseResult } from '../workers/scriptWorker';

const SCRIPT_TIMEOUT_MS = 2000;

export function runScriptInSandbox(
  input: ScriptRunInput,
): Promise<ScriptRunOutput> {
  if (!input.script.trim()) {
    return Promise.resolve({ envUpdates: {}, tests: [], logs: [] });
  }

  return new Promise((resolve) => {
    const worker = new Worker(
      new URL('../workers/scriptWorker.ts', import.meta.url),
      { type: 'module' },
    );

    const timer = setTimeout(() => {
      worker.terminate();
      resolve({
        envUpdates: {},
        tests: [],
        logs: [],
        error: `Script timed out after ${SCRIPT_TIMEOUT_MS}ms`,
      });
    }, SCRIPT_TIMEOUT_MS);

    worker.onmessage = (e: MessageEvent<ScriptRunOutput>) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(e.data);
    };

    worker.onerror = (err) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({
        envUpdates: {},
        tests: [],
        logs: [],
        error: err.message || 'Script execution error',
      });
    };

    worker.postMessage(input);
  });
}
