import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { EnvVariable } from '@api-open/shared';
import { workspaceApi } from '../api/workspace';
import { useWorkspaceStore } from './workspace';

export interface ConsoleLogEntry {
  id: string;
  type: 'http' | 'script' | 'error' | 'activity';
  method?: string;
  url?: string;
  statusCode?: number;
  durationMs?: number;
  message: string;
  timestamp: string;
}

export interface EmailLogEntry {
  id: string;
  to: string;
  subject: string;
  category: string;
  status: 'sent' | 'failed';
  error?: string | null;
  createdAt: string;
}

const VAULT_STORAGE_KEY = 'api_open_local_vault_v1';
const LOGS_STORAGE_KEY = 'api_open_console_logs_v1';

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function loadVault(): EnvVariable[] {
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as EnvVariable[]) : [];
  } catch {
    return [];
  }
}

function loadLocalLogs(): ConsoleLogEntry[] {
  try {
    const raw = localStorage.getItem(LOGS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ConsoleLogEntry[]) : [];
  } catch {
    return [];
  }
}

export const useConsoleStore = defineStore('console', () => {
  const logs = ref<ConsoleLogEntry[]>(loadLocalLogs());
  const emailLogs = ref<EmailLogEntry[]>([]);
  const localVault = ref<EnvVariable[]>(loadVault());

  watch(
    localVault,
    () => {
      try {
        localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(localVault.value));
      } catch {
        // ignore
      }
    },
    { deep: true },
  );

  watch(
    logs,
    () => {
      try {
        localStorage.setItem(
          LOGS_STORAGE_KEY,
          JSON.stringify(logs.value.slice(0, 200)),
        );
      } catch {
        // ignore
      }
    },
    { deep: true },
  );

  let inFlightSync: Promise<void> | null = null;
  let lastSyncedKey = '';

  async function syncFromDb(force = false) {
    const ws = useWorkspaceStore();
    if (!ws.accessToken) return;
    const syncKey = `${ws.activeWorkspaceId || 'global'}`;
    if (!force && lastSyncedKey === syncKey) return;
    if (inFlightSync) return inFlightSync;
    inFlightSync = (async () => {
      try {
        const [rows, emailRows] = await Promise.all([
          workspaceApi.listLogs(
            ws.accessToken!,
            ws.activeWorkspaceId || undefined,
          ),
          workspaceApi.listEmailLogs(ws.accessToken!),
        ]);
        logs.value = rows.map((r) => ({
          id: r.id,
          type: r.type,
          method: r.method ?? undefined,
          url: r.url ?? undefined,
          statusCode: r.statusCode ?? undefined,
          durationMs: r.durationMs ?? undefined,
          message: r.message,
          timestamp: r.createdAt,
        }));
        emailLogs.value = emailRows;
        lastSyncedKey = syncKey;
      } catch {
        // keep local logs if offline or API unreachable
      } finally {
        inFlightSync = null;
      }
    })();
    return inFlightSync;
  }

  function addLog(entry: Omit<ConsoleLogEntry, 'id' | 'timestamp'>) {
    const timestamp = new Date().toISOString();
    logs.value.unshift({
      ...entry,
      id: uid(),
      timestamp,
    });
    if (logs.value.length > 200) {
      logs.value = logs.value.slice(0, 200);
    }

    const ws = useWorkspaceStore();
    if (ws.accessToken) {
      workspaceApi
        .createLog(ws.accessToken, {
          ...entry,
          workspaceId: ws.activeWorkspaceId || undefined,
        })
        .catch(() => {
          // ignore background DB write errors
        });
    }
  }

  function clearLogs() {
    logs.value = [];
    const ws = useWorkspaceStore();
    if (ws.accessToken) {
      workspaceApi
        .clearLogs(ws.accessToken, ws.activeWorkspaceId || undefined)
        .catch(() => {
          // ignore
        });
    }
  }

  function addVaultVar() {
    localVault.value.push({
      id: uid(),
      key: '',
      value: '',
      isSecret: true,
      enabled: true,
    });
  }

  function removeVaultVar(id: string) {
    localVault.value = localVault.value.filter((v) => v.id !== id);
  }

  return {
    logs,
    emailLogs,
    localVault,
    syncFromDb,
    addLog,
    clearLogs,
    addVaultVar,
    removeVaultVar,
  };
});
