import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export type ThemeMode = 'light' | 'dark';
export type SidebarPosition = 'left' | 'right';
export type ResponsePosition = 'bottom' | 'right';

export interface AppSettings {
  theme: ThemeMode;
  sidebarPosition: SidebarPosition;
  sidebarWidth: number;
  responsePosition: ResponsePosition;
  responseSizePercent: number;
}

const SETTINGS_KEY = 'api_open_settings_v1';

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  sidebarPosition: 'left',
  sidebarWidth: 280,
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
  const sidebarPosition = ref<SidebarPosition>(initial.sidebarPosition);
  const sidebarWidth = ref<number>(initial.sidebarWidth);
  const responsePosition = ref<ResponsePosition>(initial.responsePosition);
  const responseSizePercent = ref<number>(initial.responseSizePercent);

  function applyTheme(mode: ThemeMode) {
    const isDark = mode === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.setAttribute('data-kt-theme-mode', mode);
  }

  applyTheme(theme.value);

  watch(
    [theme, sidebarPosition, sidebarWidth, responsePosition, responseSizePercent],
    () => {
      applyTheme(theme.value);
      try {
        localStorage.setItem(
          SETTINGS_KEY,
          JSON.stringify({
            theme: theme.value,
            sidebarPosition: sidebarPosition.value,
            sidebarWidth: sidebarWidth.value,
            responsePosition: responsePosition.value,
            responseSizePercent: responseSizePercent.value,
          } satisfies AppSettings),
        );
      } catch {
        // ignore storage errors
      }
    },
  );

  function toggleTheme() {
    theme.value = theme.value === 'light' ? 'dark' : 'light';
  }

  function resetDefaults() {
    theme.value = DEFAULT_SETTINGS.theme;
    sidebarPosition.value = DEFAULT_SETTINGS.sidebarPosition;
    sidebarWidth.value = DEFAULT_SETTINGS.sidebarWidth;
    responsePosition.value = DEFAULT_SETTINGS.responsePosition;
    responseSizePercent.value = DEFAULT_SETTINGS.responseSizePercent;
  }

  return {
    theme,
    sidebarPosition,
    sidebarWidth,
    responsePosition,
    responseSizePercent,
    toggleTheme,
    resetDefaults,
  };
});
