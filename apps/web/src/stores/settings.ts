import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

export type ThemeMode = 'system' | 'light' | 'dark';
export type NavbarPosition = 'top' | 'bottom';
export type PanelPosition = 'left' | 'right' | 'top' | 'bottom';

export interface AppSettings {
  theme: ThemeMode;
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
  const navbarPosition = ref<NavbarPosition>(initial.navbarPosition);
  const sidebarPosition = ref<PanelPosition>(initial.sidebarPosition);
  const sidebarHidden = ref<boolean>(initial.sidebarHidden);
  const sidebarWidth = ref<number>(initial.sidebarWidth);
  const sidebarHeight = ref<number>(initial.sidebarHeight);
  const responsePosition = ref<PanelPosition>(initial.responsePosition);
  const responseSizePercent = ref<number>(initial.responseSizePercent);

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

  applyTheme(effectiveTheme.value);

  watch(effectiveTheme, (resolved) => {
    applyTheme(resolved);
  });

  watch(
    [
      theme,
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

  function toggleTheme() {
    theme.value = effectiveTheme.value === 'light' ? 'dark' : 'light';
  }

  function resetDefaults() {
    theme.value = DEFAULT_SETTINGS.theme;
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
    navbarPosition,
    sidebarPosition,
    sidebarHidden,
    sidebarWidth,
    sidebarHeight,
    responsePosition,
    responseSizePercent,
    toggleTheme,
    resetDefaults,
  };
});
