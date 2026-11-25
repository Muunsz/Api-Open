import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  AuthConfig,
  BodyConfig,
  HttpMethod,
  KeyValueItem,
  ProxyExecuteResponse,
} from '@api-open/shared';
import { executeProxyRequest } from '../api/proxy';
import { type ApiRequestDto, workspaceApi } from '../api/workspace';
import { parseCurlCommand } from '../utils/curlParser';
import {
  runScriptInSandbox,
  type TestCaseResult,
} from '../utils/scriptRunner';
import { generateSnippet, type SnippetLang } from '../utils/snippetGenerator';
import { buildUrlWithParams, parseQueryFromUrl } from '../utils/urlSync';
import { resolveVariables } from '../utils/variables';
import { useWorkspaceStore } from './workspace';

export interface RequestTab {
  id: string;
  savedRequestId?: string;
  collectionId?: string;
  name: string;
  method: HttpMethod;
  url: string;
  queryParams: KeyValueItem[];
  headers: KeyValueItem[];
  auth: AuthConfig;
  body: BodyConfig;
  preRequestScript: string;
  testScript: string;
  loading: boolean;
  response: ProxyExecuteResponse | null;
  error: string | null;
  testResults: TestCaseResult[];
  scriptLogs: string[];
  scriptError: string | null;
}

export interface HistoryEntry {
  id: string;
  method: HttpMethod;
  url: string;
  statusCode?: number;
  durationMs?: number;
  timestamp: string;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function createEmptyRow(): KeyValueItem {
  return { id: uid(), key: '', value: '', description: '', enabled: true };
}

function createDefaultTab(partial?: Partial<RequestTab>): RequestTab {
  return {
    id: uid(),
    savedRequestId: partial?.savedRequestId,
    collectionId: partial?.collectionId,
    name: partial?.name ?? 'Untitled Request',
    method: partial?.method ?? 'GET',
    url: partial?.url ?? 'https://jsonplaceholder.typicode.com/todos/1',
    queryParams: partial?.queryParams?.length
      ? partial.queryParams
      : [createEmptyRow()],
    headers: partial?.headers?.length ? partial.headers : [createEmptyRow()],
    auth: partial?.auth ?? { type: 'none' },
    body: partial?.body ?? {
      mode: 'none',
      raw: '{\n  \n}',
      rawType: 'json',
      urlencoded: [createEmptyRow()],
      graphql: { query: '', variables: '{}' },
    },
    preRequestScript: partial?.preRequestScript ?? '',
    testScript: partial?.testScript ?? '',
    loading: false,
    response: null,
    error: null,
    testResults: [],
    scriptLogs: [],
    scriptError: null,
  };
}

const HISTORY_STORAGE_KEY = 'api_open_history_v1';

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export const useTabsStore = defineStore('tabs', () => {
  const initialTab = createDefaultTab();
  const tabs = ref<RequestTab[]>([initialTab]);
  const activeTabId = ref<string>(initialTab.id);
  const history = ref<HistoryEntry[]>(loadHistory());
  const runtimeEnvOverrides = ref<Record<string, string>>({});

  const activeTab = computed(
    () => tabs.value.find((t) => t.id === activeTabId.value) ?? tabs.value[0],
  );

  function addTab(partial?: Partial<RequestTab>) {
    const tab = createDefaultTab(partial);
    tabs.value.push(tab);
    activeTabId.value = tab.id;
  }

  function openSavedRequest(req: ApiRequestDto) {
    const existing = tabs.value.find((t) => t.savedRequestId === req.id);
    if (existing) {
      activeTabId.value = existing.id;
      return;
    }
    addTab({
      savedRequestId: req.id,
      collectionId: req.collectionId,
      name: req.name,
      method: req.method,
      url: req.url,
      headers: req.headers?.length ? [...req.headers] : [createEmptyRow()],
      queryParams: req.queryParams?.length
        ? [...req.queryParams]
        : [createEmptyRow()],
      auth: req.auth ?? { type: 'none' },
      body: req.body ?? { mode: 'none' },
      preRequestScript: req.preRequestScript ?? '',
      testScript: req.testScript ?? '',
    });
  }

  function closeTab(id: string) {
    if (tabs.value.length === 1) {
      const fresh = createDefaultTab();
      tabs.value = [fresh];
      activeTabId.value = fresh.id;
      return;
    }
    const idx = tabs.value.findIndex((t) => t.id === id);
    tabs.value = tabs.value.filter((t) => t.id !== id);
    if (activeTabId.value === id) {
      const next = tabs.value[Math.max(0, idx - 1)];
      activeTabId.value = next.id;
    }
  }

  function syncParamsFromUrl() {
    const tab = activeTab.value;
    if (!tab) return;
    const parsed = parseQueryFromUrl(tab.url);
    tab.queryParams = parsed.length ? parsed : [createEmptyRow()];
  }

  function syncUrlFromParams() {
    const tab = activeTab.value;
    if (!tab) return;
    tab.url = buildUrlWithParams(tab.url, tab.queryParams);
  }

  function importCurl(curlCommand: string) {
    const parsed = parseCurlCommand(curlCommand);
    const queryParams = parseQueryFromUrl(parsed.url);
    addTab({
      name: parsed.url.replace(/^https?:\/\//, '').slice(0, 28),
      method: parsed.method,
      url: parsed.url,
      headers: parsed.headers.length ? parsed.headers : [createEmptyRow()],
      queryParams: queryParams.length ? queryParams : [createEmptyRow()],
      auth: parsed.auth,
      body: parsed.body,
    });
  }

  function buildResolvedRequest(tab: RequestTab, vars: Record<string, string>) {
    const r = (val: string) => resolveVariables(val, vars);
    const resolvedUrl = r(tab.url.trim());

    const queryParams: Record<string, string> = {};
    for (const row of tab.queryParams) {
      if (row.enabled && row.key.trim()) {
        queryParams[r(row.key.trim())] = r(row.value);
      }
    }

    const headers: Record<string, string> = {};
    for (const row of tab.headers) {
      if (row.enabled && row.key.trim()) {
        headers[r(row.key.trim())] = r(row.value);
      }
    }

    if (tab.auth.type === 'bearer' && tab.auth.token) {
      headers['Authorization'] = `Bearer ${r(tab.auth.token)}`;
    } else if (tab.auth.type === 'basic' && tab.auth.username) {
      const encoded = btoa(
        `${r(tab.auth.username)}:${r(tab.auth.password ?? '')}`,
      );
      headers['Authorization'] = `Basic ${encoded}`;
    } else if (tab.auth.type === 'apikey' && tab.auth.key) {
      if (tab.auth.addTo === 'header') {
        headers[r(tab.auth.key)] = r(tab.auth.value);
      } else {
        queryParams[r(tab.auth.key)] = r(tab.auth.value);
      }
    }

    const resolvedBody: BodyConfig = {
      ...tab.body,
      raw: tab.body.raw ? r(tab.body.raw) : tab.body.raw,
      urlencoded: tab.body.urlencoded?.map((row) => ({
        ...row,
        key: r(row.key),
        value: r(row.value),
      })),
      graphql: tab.body.graphql
        ? {
            query: r(tab.body.graphql.query),
            variables: tab.body.graphql.variables
              ? r(tab.body.graphql.variables)
              : undefined,
          }
        : undefined,
    };

    return { resolvedUrl, queryParams, headers, resolvedBody };
  }

  function getSnippet(lang: SnippetLang): string {
    const tab = activeTab.value;
    if (!tab) return '';
    const ws = useWorkspaceStore();
    const vars = { ...ws.activeVariablesMap, ...runtimeEnvOverrides.value };
    const { resolvedUrl, headers, resolvedBody } = buildResolvedRequest(tab, vars);
    return generateSnippet(lang, {
      method: tab.method,
      url: resolvedUrl,
      headers,
      body: resolvedBody,
    });
  }

  function saveHistory(entry: HistoryEntry) {
    history.value = [entry, ...history.value].slice(0, 50);
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.value));
    } catch {
      // ignore storage quota errors
    }
  }

  function clearHistory() {
    history.value = [];
    localStorage.removeItem(HISTORY_STORAGE_KEY);
  }

  async function saveActiveTab(collectionId?: string, customName?: string) {
    const tab = activeTab.value;
    const ws = useWorkspaceStore();
    if (!tab || !ws.accessToken) return;

    const payload = {
      name: customName?.trim() || tab.name || tab.url || 'Untitled Request',
      method: tab.method,
      url: tab.url,
      headers: tab.headers,
      queryParams: tab.queryParams,
      auth: tab.auth,
      body: tab.body,
      preRequestScript: tab.preRequestScript,
      testScript: tab.testScript,
    };

    if (tab.savedRequestId) {
      const updated = await workspaceApi.updateRequest(
        ws.accessToken,
        tab.savedRequestId,
        payload,
      );
      tab.name = updated.name;
    } else if (collectionId) {
      const created = await workspaceApi.createRequest(
        ws.accessToken,
        collectionId,
        payload,
      );
      tab.savedRequestId = created.id;
      tab.collectionId = created.collectionId;
      tab.name = created.name;
    }

    if (ws.activeWorkspaceId) {
      await ws.loadWorkspaceData(ws.activeWorkspaceId);
    }
  }

  async function sendActiveRequest() {
    const tab = activeTab.value;
    if (!tab || !tab.url.trim()) return;

    const ws = useWorkspaceStore();
    tab.loading = true;
    tab.error = null;
    tab.testResults = [];
    tab.scriptLogs = [];
    tab.scriptError = null;

    let envSnapshot = { ...ws.activeVariablesMap, ...runtimeEnvOverrides.value };

    if (tab.preRequestScript.trim()) {
      const preResult = await runScriptInSandbox({
        script: tab.preRequestScript,
        env: envSnapshot,
      });
      if (Object.keys(preResult.envUpdates).length) {
        runtimeEnvOverrides.value = {
          ...runtimeEnvOverrides.value,
          ...preResult.envUpdates,
        };
        envSnapshot = { ...envSnapshot, ...preResult.envUpdates };
      }
      tab.scriptLogs.push(...preResult.logs);
      if (preResult.error) {
        tab.scriptError = `Pre-request script error: ${preResult.error}`;
      }
    }

    const { resolvedUrl, queryParams, headers, resolvedBody } =
      buildResolvedRequest(tab, envSnapshot);

    try {
      const res = await executeProxyRequest({
        method: tab.method,
        url: resolvedUrl,
        headers,
        queryParams,
        body: resolvedBody,
      });
      tab.response = res;

      if (tab.testScript.trim()) {
        const testOut = await runScriptInSandbox({
          script: tab.testScript,
          env: envSnapshot,
          response: {
            statusCode: res.statusCode,
            statusText: res.statusText,
            durationMs: res.durationMs,
            headers: res.headers,
            body: res.body,
          },
        });
        if (Object.keys(testOut.envUpdates).length) {
          runtimeEnvOverrides.value = {
            ...runtimeEnvOverrides.value,
            ...testOut.envUpdates,
          };
        }
        tab.testResults = testOut.tests;
        tab.scriptLogs.push(...testOut.logs);
        if (testOut.error) {
          tab.scriptError = `Test script error: ${testOut.error}`;
        }
      }

      saveHistory({
        id: uid(),
        method: tab.method,
        url: resolvedUrl,
        statusCode: res.statusCode,
        durationMs: res.durationMs,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      tab.error = err instanceof Error ? err.message : 'Request failed';
      tab.response = null;
      saveHistory({
        id: uid(),
        method: tab.method,
        url: resolvedUrl,
        timestamp: new Date().toISOString(),
      });
    } finally {
      tab.loading = false;
    }
  }

  return {
    tabs,
    activeTabId,
    activeTab,
    history,
    runtimeEnvOverrides,
    addTab,
    openSavedRequest,
    closeTab,
    syncParamsFromUrl,
    syncUrlFromParams,
    importCurl,
    getSnippet,
    clearHistory,
    saveActiveTab,
    sendActiveRequest,
    createEmptyRow,
  };
});
