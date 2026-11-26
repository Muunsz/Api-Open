import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type {
  AuthConfig,
  BodyConfig,
  HttpMethod,
  KeyValueItem,
  ProxyExecuteResponse,
  RequestSettings,
  ResponseExample,
} from '@api-open/shared';
import {
  executeBrowserDirectRequest,
  executeProxyRequest,
} from '../api/proxy';
import { type ApiRequestDto, workspaceApi } from '../api/workspace';
import { parseCurlCommand } from '../utils/curlParser';
import {
  runScriptInSandbox,
  type TestCaseResult,
} from '../utils/scriptRunner';
import { generateSnippet, type SnippetLang } from '../utils/snippetGenerator';
import {
  applyPathParamsToUrl,
  buildUrlWithParams,
  extractPathParamNames,
  parseQueryFromUrl,
} from '../utils/urlSync';
import { resolveVariables } from '../utils/variables';
import { useConsoleStore } from './console';
import { useCookiesStore } from './cookies';
import { useSettingsStore } from './settings';
import { useWorkspaceStore } from './workspace';

export interface RequestTab {
  id: string;
  savedRequestId?: string;
  collectionId?: string;
  name: string;
  method: HttpMethod;
  url: string;
  queryParams: KeyValueItem[];
  pathParams: KeyValueItem[];
  headers: KeyValueItem[];
  auth: AuthConfig;
  body: BodyConfig;
  examples: ResponseExample[];
  settings: RequestSettings;
  preRequestScript: string;
  testScript: string;
  loading: boolean;
  response: ProxyExecuteResponse | null;
  previousResponse: ProxyExecuteResponse | null;
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
    pathParams: partial?.pathParams ?? [],
    headers: partial?.headers?.length ? partial.headers : [createEmptyRow()],
    auth: partial?.auth ?? { type: 'none' },
    body: partial?.body ?? {
      mode: 'none',
      raw: '{\n  \n}',
      rawType: 'json',
      urlencoded: [createEmptyRow()],
      formData: [{ id: uid(), key: '', type: 'text', value: '', enabled: true }],
      binary: { fileName: '', contentBase64: '', mimeType: '' },
      graphql: { query: '', variables: '{}' },
    },
    examples: partial?.examples ?? [],
    settings: partial?.settings ?? {
      followRedirects: true,
      maxRedirects: 10,
      verifySsl: true,
      timeoutMs: 15000,
      encodeUrl: true,
    },
    preRequestScript: partial?.preRequestScript ?? '',
    testScript: partial?.testScript ?? '',
    loading: false,
    response: null,
    previousResponse: null,
    error: null,
    testResults: [],
    scriptLogs: [],
    scriptError: null,
  };
}

const HISTORY_STORAGE_KEY = 'api_open_history_v1';
const TABS_STORAGE_KEY = 'api_open_tabs_v1';
const RUNTIME_ENV_STORAGE_KEY = 'api_open_runtime_env_v1';

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function loadSavedTabsState(): {
  tabs: RequestTab[];
  activeTabId: string;
} {
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        tabs?: RequestTab[];
        activeTabId?: string;
      };
      if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
        const sanitized = parsed.tabs.map((t) => ({
          ...createDefaultTab(t),
          loading: false,
          response: t.response ?? null,
          error: t.error ?? null,
          testResults: t.testResults ?? [],
          scriptLogs: t.scriptLogs ?? [],
          scriptError: t.scriptError ?? null,
        }));
        const activeId =
          parsed.activeTabId && sanitized.some((t) => t.id === parsed.activeTabId)
            ? parsed.activeTabId
            : sanitized[0].id;
        return { tabs: sanitized, activeTabId: activeId };
      }
    }
  } catch {
    // ignore invalid localStorage data
  }
  const fallback = createDefaultTab();
  return { tabs: [fallback], activeTabId: fallback.id };
}

function loadRuntimeEnv(): Record<string, string> {
  try {
    const raw = localStorage.getItem(RUNTIME_ENV_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export const useTabsStore = defineStore('tabs', () => {
  const initialState = loadSavedTabsState();
  const tabs = ref<RequestTab[]>(initialState.tabs);
  const activeTabId = ref<string>(initialState.activeTabId);
  const history = ref<HistoryEntry[]>(loadHistory());
  const runtimeEnvOverrides = ref<Record<string, string>>(loadRuntimeEnv());

  watch(
    [tabs, activeTabId],
    () => {
      try {
        const serializableTabs = tabs.value.map((t) => ({
          ...t,
          loading: false,
          // Keep response small in localStorage (skip huge >100KB payloads)
          response:
            t.response && t.response.sizeBytes < 100_000 ? t.response : null,
        }));
        localStorage.setItem(
          TABS_STORAGE_KEY,
          JSON.stringify({
            tabs: serializableTabs,
            activeTabId: activeTabId.value,
          }),
        );
      } catch {
        // ignore quota exceeded
      }
    },
    { deep: true },
  );

  watch(
    runtimeEnvOverrides,
    () => {
      try {
        localStorage.setItem(
          RUNTIME_ENV_STORAGE_KEY,
          JSON.stringify(runtimeEnvOverrides.value),
        );
      } catch {
        // ignore
      }
    },
    { deep: true },
  );

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
      pathParams: req.pathParams?.length ? [...req.pathParams] : [],
      auth: req.auth ?? { type: 'none' },
      body: req.body ?? { mode: 'none' },
      examples: req.examples?.length ? [...req.examples] : [],
      settings: req.settings ?? {
        followRedirects: true,
        maxRedirects: 10,
        verifySsl: true,
        timeoutMs: 15000,
        encodeUrl: true,
      },
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

  function syncPathParamsFromUrl(targetTab?: RequestTab) {
    const tab = targetTab ?? activeTab.value;
    if (!tab) return;
    const names = extractPathParamNames(tab.url);
    const existingMap = new Map(tab.pathParams.map((p) => [p.key, p]));
    tab.pathParams = names.map((name) => {
      const prev = existingMap.get(name);
      return (
        prev ?? {
          id: uid(),
          key: name,
          value: '',
          description: '',
          enabled: true,
        }
      );
    });
  }

  function syncParamsFromUrl() {
    const tab = activeTab.value;
    if (!tab) return;
    const parsed = parseQueryFromUrl(tab.url);
    tab.queryParams = parsed.length ? parsed : [createEmptyRow()];
    syncPathParamsFromUrl(tab);
  }

  function syncUrlFromParams() {
    const tab = activeTab.value;
    if (!tab) return;
    const settings = useSettingsStore();
    tab.url = buildUrlWithParams(
      tab.url,
      tab.queryParams,
      settings.queryEncoding,
    );
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
    const resolvedUrl = applyPathParamsToUrl(
      r(tab.url.trim()),
      tab.pathParams ?? [],
      r,
    );

    const queryParams: Record<string, string> = {};
    for (const row of tab.queryParams) {
      if (row.enabled && row.key.trim()) {
        queryParams[r(row.key.trim())] = r(row.value);
      }
    }

    const ws = useWorkspaceStore();
    const inherited = ws.getEffectiveCollectionAuthAndHeaders(tab.collectionId);

    const headers: Record<string, string> = {};
    for (const row of inherited.headers) {
      if (row.enabled && row.key.trim()) {
        headers[r(row.key.trim())] = r(row.value);
      }
    }
    for (const row of tab.headers) {
      if (row.enabled && row.key.trim()) {
        headers[r(row.key.trim())] = r(row.value);
      }
    }

    const effectiveAuth: AuthConfig =
      tab.auth.type === 'inherit' ? inherited.auth : tab.auth;

    let resolvedAuth: AuthConfig | undefined;

    if (effectiveAuth.type === 'bearer' && effectiveAuth.token) {
      headers['Authorization'] = `Bearer ${r(effectiveAuth.token)}`;
    } else if (effectiveAuth.type === 'oauth2' && effectiveAuth.accessToken) {
      const prefix = effectiveAuth.headerPrefix?.trim() || 'Bearer';
      headers['Authorization'] = `${prefix} ${r(effectiveAuth.accessToken)}`;
    } else if (effectiveAuth.type === 'basic' && effectiveAuth.username) {
      const encoded = btoa(
        `${r(effectiveAuth.username)}:${r(effectiveAuth.password ?? '')}`,
      );
      headers['Authorization'] = `Basic ${encoded}`;
    } else if (effectiveAuth.type === 'apikey' && effectiveAuth.key) {
      if (effectiveAuth.addTo === 'header') {
        headers[r(effectiveAuth.key)] = r(effectiveAuth.value);
      } else {
        queryParams[r(effectiveAuth.key)] = r(effectiveAuth.value);
      }
    } else if (effectiveAuth.type === 'digest') {
      resolvedAuth = {
        type: 'digest',
        username: r(effectiveAuth.username),
        password: r(effectiveAuth.password),
      };
    } else if (effectiveAuth.type === 'aws') {
      resolvedAuth = {
        type: 'aws',
        accessKey: r(effectiveAuth.accessKey),
        secretKey: r(effectiveAuth.secretKey),
        region: r(effectiveAuth.region),
        service: r(effectiveAuth.service),
        sessionToken: effectiveAuth.sessionToken
          ? r(effectiveAuth.sessionToken)
          : undefined,
      };
    } else if (effectiveAuth.type === 'hawk') {
      resolvedAuth = {
        type: 'hawk',
        hawkId: r(effectiveAuth.hawkId),
        hawkKey: r(effectiveAuth.hawkKey),
        algorithm: effectiveAuth.algorithm,
      };
    } else if (effectiveAuth.type === 'jwt') {
      resolvedAuth = {
        type: 'jwt',
        secret: r(effectiveAuth.secret),
        algorithm: effectiveAuth.algorithm,
        payload: r(effectiveAuth.payload),
        headerPrefix: effectiveAuth.headerPrefix
          ? r(effectiveAuth.headerPrefix)
          : 'Bearer',
      };
    }

    const resolvedBody: BodyConfig = {
      ...tab.body,
      raw: tab.body.raw ? r(tab.body.raw) : tab.body.raw,
      urlencoded: tab.body.urlencoded?.map((row) => ({
        ...row,
        key: r(row.key),
        value: r(row.value),
      })),
      formData: tab.body.formData?.map((row) => ({
        ...row,
        key: r(row.key),
        value: row.type === 'text' ? r(row.value) : row.value,
      })),
      binary: tab.body.binary,
      graphql: tab.body.graphql
        ? {
            query: r(tab.body.graphql.query),
            variables: tab.body.graphql.variables
              ? r(tab.body.graphql.variables)
              : undefined,
          }
        : undefined,
    };

    return { resolvedUrl, queryParams, headers, resolvedAuth, resolvedBody };
  }

  function getSnippet(lang: SnippetLang): string {
    const tab = activeTab.value;
    if (!tab) return '';
    const ws = useWorkspaceStore();
    const consoleStore = useConsoleStore();
    const vaultMap: Record<string, string> = {};
    for (const v of consoleStore.localVault) {
      if (v.enabled && v.key.trim()) {
        vaultMap[v.key.trim()] = v.value ?? '';
      }
    }
    const vars = {
      ...ws.activeVariablesMap,
      ...vaultMap,
      ...runtimeEnvOverrides.value,
    };
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
    const ws = useWorkspaceStore();
    if (ws.accessToken && ws.activeWorkspaceId) {
      workspaceApi
        .createHistory(ws.accessToken, ws.activeWorkspaceId, {
          method: entry.method,
          url: entry.url,
          statusCode: entry.statusCode,
          durationMs: entry.durationMs,
        })
        .catch(() => undefined);
    }
  }

  async function syncHistoryFromServer() {
    const ws = useWorkspaceStore();
    if (!ws.accessToken || !ws.activeWorkspaceId) return;
    try {
      const rows = await workspaceApi.listHistory(
        ws.accessToken,
        ws.activeWorkspaceId,
        100,
      );
      if (rows.length) {
        history.value = rows.map((r) => ({
          id: r.id,
          method: r.method,
          url: r.url,
          statusCode: r.statusCode ?? undefined,
          durationMs: r.durationMs ?? undefined,
          timestamp: r.createdAt,
        }));
      }
    } catch {
      // ignore
    }
  }

  function clearHistory() {
    history.value = [];
    localStorage.removeItem(HISTORY_STORAGE_KEY);
    const ws = useWorkspaceStore();
    if (ws.accessToken && ws.activeWorkspaceId) {
      workspaceApi
        .clearHistory(ws.accessToken, ws.activeWorkspaceId)
        .catch(() => undefined);
    }
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
      pathParams: tab.pathParams,
      auth: tab.auth,
      body: tab.body,
      examples: tab.examples,
      settings: tab.settings,
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
      await ws.refreshCollections(ws.activeWorkspaceId);
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

    const consoleStore = useConsoleStore();
    const vaultMap: Record<string, string> = {};
    for (const v of consoleStore.localVault) {
      if (v.enabled && v.key.trim()) {
        vaultMap[v.key.trim()] = v.value ?? '';
      }
    }
    const inherited = ws.getEffectiveCollectionAuthAndHeaders(tab.collectionId);
    let envSnapshot = {
      ...ws.activeVariablesMap,
      ...inherited.variables,
      ...vaultMap,
      ...runtimeEnvOverrides.value,
    };

    if (tab.preRequestScript.trim()) {
      const combinedPre = ws.sharedScript.trim()
        ? `${ws.sharedScript}\n${tab.preRequestScript}`
        : tab.preRequestScript;
      const preResult = await runScriptInSandbox({
        script: combinedPre,
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
      if (preResult.logs.length) {
        consoleStore.addLog({
          type: 'script',
          message: `[Pre-request] ${preResult.logs.join(' | ')}`,
        });
      }
      if (preResult.error) {
        tab.scriptError = `Pre-request script error: ${preResult.error}`;
        consoleStore.addLog({
          type: 'error',
          message: tab.scriptError,
        });
      }
    }

    const { resolvedUrl, queryParams, headers, resolvedAuth, resolvedBody } =
      buildResolvedRequest(tab, envSnapshot);

    const settings = useSettingsStore();
    const cookiesStore = useCookiesStore();

    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'cookie')) {
      const cookieHeader = cookiesStore.getCookieHeaderForUrl(resolvedUrl);
      if (cookieHeader) {
        headers['Cookie'] = cookieHeader;
      }
    }

    try {
      const executor =
        settings.interceptor === 'browser'
          ? executeBrowserDirectRequest
          : executeProxyRequest;

      let matchedCert = undefined;
      try {
        const parsedTarget = new URL(resolvedUrl);
        matchedCert = settings.clientCerts.find(
          (c) => c.host.trim() && parsedTarget.host.includes(c.host.trim()),
        );
      } catch {
        // ignore invalid url
      }

      const res = await executor({
        method: tab.method,
        url: resolvedUrl,
        headers,
        queryParams,
        auth: resolvedAuth,
        body: resolvedBody,
        timeoutMs: tab.settings?.timeoutMs,
        followRedirects: tab.settings?.followRedirects,
        maxRedirects: tab.settings?.maxRedirects,
        verifySsl: tab.settings?.verifySsl,
        clientCert: matchedCert,
        tunnelProxy: settings.tunnelProxy.url.trim()
          ? {
              url: settings.tunnelProxy.url.trim(),
              username: settings.tunnelProxy.username || undefined,
              password: settings.tunnelProxy.password || undefined,
            }
          : undefined,
      });
      if (tab.response) {
        tab.previousResponse = tab.response;
      }
      tab.response = res;
      cookiesStore.captureFromResponseHeaders(resolvedUrl, res.headers);
      consoleStore.addLog({
        type: 'http',
        method: tab.method,
        url: resolvedUrl,
        statusCode: res.statusCode,
        durationMs: res.durationMs,
        message: `${tab.method} ${resolvedUrl} → ${res.statusCode} (${res.durationMs}ms)`,
      });

      if (tab.testScript.trim()) {
        const combinedTest = ws.sharedScript.trim()
          ? `${ws.sharedScript}\n${tab.testScript}`
          : tab.testScript;
        const testOut = await runScriptInSandbox({
          script: combinedTest,
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
        if (testOut.logs.length) {
          consoleStore.addLog({
            type: 'script',
            message: `[Test] ${testOut.logs.join(' | ')}`,
          });
        }
        if (testOut.error) {
          tab.scriptError = `Test script error: ${testOut.error}`;
          consoleStore.addLog({
            type: 'error',
            message: tab.scriptError,
          });
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
      consoleStore.addLog({
        type: 'error',
        method: tab.method,
        url: resolvedUrl,
        message: `${tab.method} ${resolvedUrl} — ${tab.error}`,
      });
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

  async function saveResponseAsExample(exampleName?: string) {
    const tab = activeTab.value;
    if (!tab || !tab.response) return;
    const example: ResponseExample = {
      id: uid(),
      name:
        exampleName?.trim() ||
        `${tab.response.statusCode} ${tab.response.statusText}`.trim(),
      statusCode: tab.response.statusCode,
      statusText: tab.response.statusText,
      headers: tab.response.headers,
      body: tab.response.body,
      createdAt: new Date().toISOString(),
    };
    tab.examples = [example, ...(tab.examples ?? [])].slice(0, 10);
    if (tab.savedRequestId) {
      await saveActiveTab();
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
    syncPathParamsFromUrl,
    syncUrlFromParams,
    importCurl,
    getSnippet,
    clearHistory,
    syncHistoryFromServer,
    saveActiveTab,
    saveResponseAsExample,
    sendActiveRequest,
    createEmptyRow,
  };
});
