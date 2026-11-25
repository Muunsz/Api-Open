import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { EnvVariable } from '@api-open/shared';

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

const VAULT_STORAGE_KEY = 'api_open_local_vault_v1';

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

export const useConsoleStore = defineStore('console', () => {
  const logs = ref<ConsoleLogEntry[]>([]);
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

  function addLog(entry: Omit<ConsoleLogEntry, 'id' | 'timestamp'>) {
    logs.value.unshift({
      ...entry,
      id: uid(),
      timestamp: new Date().toLocaleTimeString(),
    });
    if (logs.value.length > 200) {
      logs.value = logs.value.slice(0, 200);
    }
  }

  function clearLogs() {
    logs.value = [];
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
    localVault,
    addLog,
    clearLogs,
    addVaultVar,
    removeVaultVar,
  };
});
