import { computed } from 'vue';
import { useSettingsStore } from '../stores/settings';

const MESSAGES = {
  en: {
    send: 'Send',
    save: 'Save',
    searchApi: 'Search API...',
    environments: 'Environments',
    collections: 'Collections',
    history: 'History',
    settings: 'Settings',
    analytics: 'Analytics',
    toolbox: 'Dev Toolbox',
    webhooks: 'Webhook Bin',
    trash: 'Trash',
    plugins: 'Plugins & Themes',
  },
  id: {
    send: 'Kirim',
    save: 'Simpan',
    searchApi: 'Cari API...',
    environments: 'Environment',
    collections: 'Koleksi',
    history: 'Riwayat',
    settings: 'Pengaturan',
    analytics: 'Analitik',
    toolbox: 'Alat Developer',
    webhooks: 'Penangkap Webhook',
    trash: 'Sampah',
    plugins: 'Plugin & Tema',
  },
} as const;

export type LocaleCode = keyof typeof MESSAGES;
export type I18nKey = keyof (typeof MESSAGES)['en'];

export function useI18n() {
  const settings = useSettingsStore();
  const locale = computed(() => settings.locale);
  function t(key: I18nKey): string {
    return MESSAGES[settings.locale]?.[key] ?? MESSAGES.en[key];
  }
  return { locale, t };
}
