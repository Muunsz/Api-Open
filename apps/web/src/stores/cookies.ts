import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { supabase } from '../lib/supabase';

export interface CookieEntry {
  id: string;
  name: string;
  value: string;
}

export interface CookieDomainJar {
  domain: string;
  cookies: CookieEntry[];
}

const COOKIES_STORAGE_KEY = 'api_open_cookies_v1';

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function loadCookieJar(): CookieDomainJar[] {
  try {
    const raw = localStorage.getItem(COOKIES_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CookieDomainJar[]) : [];
  } catch {
    return [];
  }
}

export const useCookiesStore = defineStore('cookies', () => {
  const domains = ref<CookieDomainJar[]>(loadCookieJar());

  watch(
    domains,
    () => {
      try {
        localStorage.setItem(COOKIES_STORAGE_KEY, JSON.stringify(domains.value));
      } catch {
        // ignore quota errors
      }
      if (supabase) {
        supabase.auth.getSession().then(({ data }) => {
          if (data.session) {
            supabase!.auth.updateUser({ data: { api_open_cookies: domains.value } }).catch(() => undefined);
          }
        });
      }
    },
    { deep: true },
  );

  async function syncFromCloud() {
    if (!supabase) return;
    const { data } = await supabase.auth.getUser();
    const cloud = data.user?.user_metadata?.api_open_cookies as CookieDomainJar[] | undefined;
    if (Array.isArray(cloud) && cloud.length) {
      domains.value = cloud;
    }
  }

  function addDomain(domain: string) {
    const clean = domain.trim().toLowerCase();
    if (!clean || domains.value.some((d) => d.domain === clean)) return;
    domains.value.push({ domain: clean, cookies: [] });
  }

  function removeDomain(domain: string) {
    domains.value = domains.value.filter((d) => d.domain !== domain);
  }

  function addCookie(domain: string, name: string, value: string) {
    const target = domains.value.find((d) => d.domain === domain);
    if (!target || !name.trim()) return;
    const existing = target.cookies.find((c) => c.name === name.trim());
    if (existing) {
      existing.value = value;
    } else {
      target.cookies.push({ id: uid(), name: name.trim(), value });
    }
  }

  function removeCookie(domain: string, cookieId: string) {
    const target = domains.value.find((d) => d.domain === domain);
    if (!target) return;
    target.cookies = target.cookies.filter((c) => c.id !== cookieId);
  }

  function clearAll() {
    domains.value = [];
  }

  function captureFromResponseHeaders(
    targetUrl: string,
    headers: Record<string, string>,
  ) {
    const setCookieHeader = headers['set-cookie'];
    if (!setCookieHeader) return;

    let hostname: string;
    try {
      hostname = new URL(targetUrl).hostname.toLowerCase();
    } catch {
      return;
    }

    if (!domains.value.some((d) => d.domain === hostname)) {
      domains.value.push({ domain: hostname, cookies: [] });
    }

    const parts = setCookieHeader.split(/,(?=\s*[^;=]+=[^;]+)/);
    for (const part of parts) {
      const nameVal = part.split(';')[0]?.trim() ?? '';
      const eqIdx = nameVal.indexOf('=');
      if (eqIdx > 0) {
        const name = nameVal.slice(0, eqIdx).trim();
        const value = nameVal.slice(eqIdx + 1).trim();
        addCookie(hostname, name, value);
      }
    }
  }

  function getCookieHeaderForUrl(targetUrl: string): string | null {
    let hostname: string;
    try {
      hostname = new URL(targetUrl).hostname.toLowerCase();
    } catch {
      return null;
    }

    const matching = domains.value.filter(
      (d) => hostname === d.domain || hostname.endsWith(`.${d.domain}`),
    );
    const pairs = matching.flatMap((d) =>
      d.cookies.filter((c) => c.name).map((c) => `${c.name}=${c.value}`),
    );
    return pairs.length ? pairs.join('; ') : null;
  }

  return {
    domains,
    addDomain,
    removeDomain,
    addCookie,
    removeCookie,
    clearAll,
    captureFromResponseHeaders,
    getCookieHeaderForUrl,
    syncFromCloud,
  };
});
