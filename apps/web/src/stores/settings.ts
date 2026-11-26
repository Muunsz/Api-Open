import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { ClientCertConfig } from '@api-open/shared';

export type ThemeMode = 'system' | 'light' | 'dark';
export type NavbarPosition = 'top' | 'bottom';
export type PanelPosition = 'left' | 'right' | 'top' | 'bottom';
export type InterceptorMode = 'proxy' | 'browser';
export type QueryEncodingMode = 'auto' | 'enable' | 'disable';

export const ACCENT_COLORS = [
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Rose', value: '#f43f5e' },
  { name: 'Cyan', value: '#06b6d4' },
] as const;

export interface AppSettings {
  theme: ThemeMode;
  accentColor: string;
  interceptor: InterceptorMode;
  queryEncoding: QueryEncodingMode;
  navbarPosition: NavbarPosition;
  sidebarPosition: PanelPosition;
  sidebarHidden: boolean;
  sidebarWidth: number;
  sidebarHeight: number;
  responsePosition: PanelPosition;
  responseSizePercent: number;
}

const SETTINGS_KEY = 'api_open_settings_v1';

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  accentColor: '#3b82f6',
  interceptor: 'proxy',
  queryEncoding: 'auto',
  navbarPosition: 'top',
  sidebarPosition: 'left',
  sidebarHidden: false,
  sidebarWidth: 280,
  sidebarHeight: 220,
  responsePosition: 'bottom',
  responseSizePercent: 45,
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const initial = loadSettings();
  const theme = ref<ThemeMode>(initial.theme);
  const accentColor = ref<string>(initial.accentColor);
  const interceptor = ref<InterceptorMode>(initial.interceptor);
  const queryEncoding = ref<QueryEncodingMode>(initial.queryEncoding);
  const navbarPosition = ref<NavbarPosition>(initial.navbarPosition);
  const sidebarPosition = ref<PanelPosition>(
    initial.sidebarPosition === 'right' ? 'right' : 'left',
  );
  const sidebarHidden = ref<boolean>(initial.sidebarHidden);
  const sidebarWidth = ref<number>(initial.sidebarWidth);
  const sidebarHeight = ref<number>(initial.sidebarHeight);
  const responsePosition = ref<PanelPosition>(initial.responsePosition);
  const responseSizePercent = ref<number>(initial.responseSizePercent);

  const CERTS_KEY = 'api_open_client_certs_v1';
  const clientCerts = ref<ClientCertConfig[]>((() => {
    try {
      const raw = localStorage.getItem(CERTS_KEY);
      return raw ? (JSON.parse(raw) as ClientCertConfig[]) : [];
    } catch {
      return [];
    }
  })());

  const PROXY_KEY = 'api_open_custom_proxy_v1';
  const customProxyUrl = ref<string>(localStorage.getItem(PROXY_KEY) ?? '');
  const savedProxyUrls = ref<string[]>([
    'http://localhost:3001/api',
    'https://api-proxy.internal/api',
  ]);

  watch(customProxyUrl, (val) => {
    try {
      if (val.trim()) localStorage.setItem(PROXY_KEY, val.trim());
      else localStorage.removeItem(PROXY_KEY);
    } catch {
      // ignore
    }
  });

  watch(
    clientCerts,
    (val) => {
      try {
        localStorage.setItem(CERTS_KEY, JSON.stringify(val));
      } catch {
        // ignore
      }
    },
    { deep: true },
  );

  const mediaQuery =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
  const systemPrefersDark = ref<boolean>(mediaQuery?.matches ?? false);

  mediaQuery?.addEventListener('change', (e) => {
    systemPrefersDark.value = e.matches;
  });

  const effectiveTheme = computed<'light' | 'dark'>(() => {
    if (theme.value === 'system') {
      return systemPrefersDark.value ? 'dark' : 'light';
    }
    return theme.value;
  });

  function applyTheme(resolved: 'light' | 'dark') {
    const isDark = resolved === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.setAttribute('data-kt-theme-mode', resolved);
  }

  function applyAccent(color: string) {
    document.documentElement.style.setProperty('--ao-accent', color);
    document.documentElement.style.setProperty('--el-color-primary', color);
  }

  applyTheme(effectiveTheme.value);
  applyAccent(accentColor.value);

  watch(effectiveTheme, (resolved) => {
    applyTheme(resolved);
  });

  watch(accentColor, (color) => {
    applyAccent(color);
  });

  watch(
    [
      theme,
      accentColor,
      interceptor,
      queryEncoding,
      navbarPosition,
      sidebarPosition,
      sidebarHidden,
      sidebarWidth,
      sidebarHeight,
      responsePosition,
      responseSizePercent,
    ],
    () => {
      try {
        localStorage.setItem(
          SETTINGS_KEY,
          JSON.stringify({
            theme: theme.value,
            accentColor: accentColor.value,
            interceptor: interceptor.value,
            queryEncoding: queryEncoding.value,
            navbarPosition: navbarPosition.value,
            sidebarPosition: sidebarPosition.value,
            sidebarHidden: sidebarHidden.value,
            sidebarWidth: sidebarWidth.value,
            sidebarHeight: sidebarHeight.value,
            responsePosition: responsePosition.value,
            responseSizePercent: responseSizePercent.value,
          } satisfies AppSettings),
        );
      } catch {
        // ignore storage errors
      }
    },
  );

  const LOCALE_KEY = 'api_open_locale_v1';
  const locale = ref<'en' | 'id'>(
    localStorage.getItem(LOCALE_KEY) === 'id' ? 'id' : 'en',
  );
  const activeThemePlugin = ref<string>(
    localStorage.getItem('api_open_theme_plugin_v1') || 'default',
  );
  watch(locale, (v) => {
    try { localStorage.setItem(LOCALE_KEY, v); } catch { /* ignore */ }
  });
  watch(activeThemePlugin, (v) => {
    try { localStorage.setItem('api_open_theme_plugin_v1', v); } catch { /* ignore */ }
  });

  const TUNNEL_KEY = 'api_open_tunnel_proxy_v1';
  const tunnelProxy = ref<{ url: string; username: string; password: string }>((() => {
    try {
      const raw = localStorage.getItem(TUNNEL_KEY);
      return raw ? JSON.parse(raw) : { url: '', username: '', password: '' };
    } catch {
      return { url: '', username: '', password: '' };
    }
  })());

  watch(
    tunnelProxy,
    (val) => {
      try {
        localStorage.setItem(TUNNEL_KEY, JSON.stringify(val));
      } catch {
        // ignore
      }
    },
    { deep: true },
  );

  const AI_KEY = 'api_open_ai_config_v1';
  const aiConfig = ref<{
    provider: 'local' | 'gemini' | 'groq' | 'openrouter' | 'ollama';
    apiKey: string;
    model: string;
    ollamaUrl: string;
  }>((() => {
    try {
      const raw = localStorage.getItem(AI_KEY);
      return raw
        ? JSON.parse(raw)
        : { provider: 'local', apiKey: '', model: '', ollamaUrl: 'http://localhost:11434' };
    } catch {
      return { provider: 'local', apiKey: '', model: '', ollamaUrl: 'http://localhost:11434' };
    }
  })());

  watch(
    aiConfig,
    (val) => {
      try {
        localStorage.setItem(AI_KEY, JSON.stringify(val));
      } catch {
        // ignore
      }
    },
    { deep: true },
  );

  function toggleTheme() {
    theme.value = effectiveTheme.value === 'light' ? 'dark' : 'light';
  }

  function resetDefaults() {
    theme.value = DEFAULT_SETTINGS.theme;
    accentColor.value = DEFAULT_SETTINGS.accentColor;
    interceptor.value = DEFAULT_SETTINGS.interceptor;
    queryEncoding.value = DEFAULT_SETTINGS.queryEncoding;
    navbarPosition.value = DEFAULT_SETTINGS.navbarPosition;
    sidebarPosition.value = DEFAULT_SETTINGS.sidebarPosition;
    sidebarHidden.value = DEFAULT_SETTINGS.sidebarHidden;
    sidebarWidth.value = DEFAULT_SETTINGS.sidebarWidth;
    sidebarHeight.value = DEFAULT_SETTINGS.sidebarHeight;
    responsePosition.value = DEFAULT_SETTINGS.responsePosition;
    responseSizePercent.value = DEFAULT_SETTINGS.responseSizePercent;
  }

  return {
    theme,
    effectiveTheme,
    accentColor,
    interceptor,
    queryEncoding,
    navbarPosition,
    sidebarPosition,
    sidebarHidden,
    sidebarWidth,
    sidebarHeight,
    responsePosition,
    responseSizePercent,
    clientCerts,
    customProxyUrl,
    savedProxyUrls,
    tunnelProxy,
    aiConfig,
    locale,
    activeThemePlugin,
    toggleTheme,
    resetDefaults,
  };
});
