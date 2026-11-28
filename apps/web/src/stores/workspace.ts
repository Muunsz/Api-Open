import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { User } from '@supabase/supabase-js';
import type { AuthConfig, EnvVariable, KeyValueItem } from '@api-open/shared';
import { ElNotification } from 'element-plus';
import { supabase } from '../lib/supabase';
import {
  type ApiRequestDto,
  type CollectionDto,
  type EnvironmentDto,
  type MonitorDto,
  type UserProfileDto,
  type WorkspaceDto,
  type WorkspaceMemberDto,
  workspaceApi,
} from '../api/workspace';

export type { ApiRequestDto, CollectionDto };
import { parseHarExport, parseInsomniaExport } from '../utils/importConverters';
import { parseOpenApiSpec } from '../utils/openApiConverter';
import { parseUniversalCollection } from '../utils/universalCollectionConverter';
import {
  type ImportedCollectionNode,
  parsePostmanCollection,
} from '../utils/postmanConverter';
import { useConsoleStore } from './console';

export interface CollectionTreeNode {
  id: string;
  label: string;
  kind: 'collection' | 'request';
  collection?: CollectionDto;
  request?: ApiRequestDto;
  children?: CollectionTreeNode[];
}

const LOCAL_ENVS_KEY = 'api_open_local_envs_v1';

function loadLocalEnvironments(): EnvironmentDto[] {
  try {
    const raw = localStorage.getItem(LOCAL_ENVS_KEY);
    return raw ? (JSON.parse(raw) as EnvironmentDto[]) : [];
  } catch {
    return [];
  }
}

function saveLocalEnvironments(envs: EnvironmentDto[]) {
  try {
    localStorage.setItem(LOCAL_ENVS_KEY, JSON.stringify(envs));
  } catch {
    // ignore
  }
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const user = ref<User | null>(null);
  const profile = ref<UserProfileDto | null>(null);
  const accessToken = ref<string | null>(null);
  const workspaces = ref<WorkspaceDto[]>([]);
  const activeWorkspaceId = ref<string>(
    localStorage.getItem('api_open_active_ws_v1') || '',
  );
  const collections = ref<CollectionDto[]>([]);
  const environments = ref<EnvironmentDto[]>(loadLocalEnvironments());
  const members = ref<WorkspaceMemberDto[]>([]);
  const monitors = ref<MonitorDto[]>([]);
  const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const offlineQueue = ref<Array<{ id: string; type: 'create_collection' | 'create_env'; payload: Record<string, unknown> }>>(
    (() => {
      try {
        const raw = localStorage.getItem('api_open_offline_queue_v1');
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    })(),
  );
  const schemas = ref<Array<{ id: string; name: string; jsonSchema: string }>>(
    (() => {
      try {
        const raw = localStorage.getItem('api_open_schemas_v1');
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    })(),
  );

  watch(
    offlineQueue,
    (q) => {
      try {
        localStorage.setItem('api_open_offline_queue_v1', JSON.stringify(q));
      } catch {
        // ignore
      }
    },
    { deep: true },
  );

  watch(
    schemas,
    (s) => {
      try {
        localStorage.setItem('api_open_schemas_v1', JSON.stringify(s));
      } catch {
        // ignore
      }
    },
    { deep: true },
  );

  async function flushOfflineQueue() {
    if (!navigator.onLine || !accessToken.value || !activeWorkspaceId.value || !offlineQueue.value.length) {
      return 0;
    }
    const pending = [...offlineQueue.value];
    offlineQueue.value = [];
    let synced = 0;
    for (const item of pending) {
      try {
        if (item.type === 'create_collection') {
          await workspaceApi.createCollection(
            accessToken.value,
            activeWorkspaceId.value,
            String(item.payload.name),
            item.payload.parentId ? String(item.payload.parentId) : undefined,
          );
          synced++;
        } else if (item.type === 'create_env') {
          await workspaceApi.createEnvironment(
            accessToken.value,
            activeWorkspaceId.value,
            String(item.payload.name),
            (item.payload.variables as EnvVariable[]) ?? [],
          );
          synced++;
        }
      } catch {
        offlineQueue.value.push(item);
      }
    }
    if (synced > 0) {
      await loadWorkspaceData(activeWorkspaceId.value);
    }
    return synced;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      isOnline.value = true;
      flushOfflineQueue().catch(() => undefined);
    });
    window.addEventListener('offline', () => {
      isOnline.value = false;
    });
  }
  const activeEnvId = ref<string>(
    localStorage.getItem('api_open_active_env_v1') || '',
  );
  const loadingData = ref(false);
  const busyCount = ref(0);
  const isBusy = computed(() => loadingData.value || busyCount.value > 0);
  const operationProgress = ref<{
    active: boolean;
    label: string;
    detail: string;
    current: number;
    total: number;
    percent: number;
  }>({
    active: false,
    label: '',
    detail: '',
    current: 0,
    total: 0,
    percent: 0,
  });

  function startOperationProgress(label: string, total: number) {
    operationProgress.value = {
      active: true,
      label,
      detail: 'Preparing...',
      current: 0,
      total: Math.max(1, total),
      percent: 0,
    };
  }

  function advanceOperationProgress(detail?: string, step = 1) {
    if (!operationProgress.value.active) return;
    const nextCurrent = Math.min(
      operationProgress.value.total,
      operationProgress.value.current + step,
    );
    const nextPercent = Math.min(
      99,
      Math.round((nextCurrent / operationProgress.value.total) * 100),
    );
    operationProgress.value = {
      ...operationProgress.value,
      current: nextCurrent,
      percent: nextPercent,
      detail: detail ?? operationProgress.value.detail,
    };
  }

  function finishOperationProgress() {
    if (!operationProgress.value.active) return;
    operationProgress.value = {
      ...operationProgress.value,
      current: operationProgress.value.total,
      percent: 100,
      detail: 'Completed',
    };
    window.setTimeout(() => {
      operationProgress.value = {
        active: false,
        label: '',
        detail: '',
        current: 0,
        total: 0,
        percent: 0,
      };
    }, 450);
  }

  function resetOperationProgress() {
    operationProgress.value = {
      active: false,
      label: '',
      detail: '',
      current: 0,
      total: 0,
      percent: 0,
    };
  }
  async function withBusy<T>(fn: () => Promise<T>): Promise<T> {
    busyCount.value++;
    try {
      return await fn();
    } finally {
      busyCount.value = Math.max(0, busyCount.value - 1);
    }
  }

  watch(activeWorkspaceId, (id) => {
    try {
      if (id) localStorage.setItem('api_open_active_ws_v1', id);
      else localStorage.removeItem('api_open_active_ws_v1');
    } catch {
      // ignore
    }
  });

  watch(activeEnvId, (id) => {
    try {
      if (id) localStorage.setItem('api_open_active_env_v1', id);
      else localStorage.removeItem('api_open_active_env_v1');
    } catch {
      // ignore
    }
  });

  const needsPasswordSetup = ref(false);
  const needsEmailVerification = ref(false);
  const pendingVerificationEmail = ref('');
  const isAuthenticated = computed(() => Boolean(accessToken.value && user.value));
  const currentUserRole = computed(() => {
    const wsObj = workspaces.value.find((w) => w.id === activeWorkspaceId.value);
    return wsObj?.role ?? 'OWNER';
  });
  const canEdit = computed(() => currentUserRole.value !== 'VIEWER');

  const activeVariablesMap = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    const globals = environments.value.filter((e) => e.isGlobal);
    for (const env of globals) {
      for (const v of env.variables) {
        if (v.enabled && v.key.trim()) map[v.key.trim()] = v.value ?? '';
      }
    }
    const active = environments.value.find((e) => e.id === activeEnvId.value);
    if (active) {
      for (const v of active.variables) {
        if (v.enabled && v.key.trim()) map[v.key.trim()] = v.value ?? '';
      }
    }
    return map;
  });

  const collectionTree = computed<CollectionTreeNode[]>(() => {
    const map = new Map<string, CollectionTreeNode>();
    const roots: CollectionTreeNode[] = [];

    for (const col of collections.value) {
      const reqNodes: CollectionTreeNode[] = (col.requests ?? []).map((r) => ({
        id: `req-${r.id}`,
        label: r.name,
        kind: 'request',
        request: r,
      }));
      map.set(col.id, {
        id: `col-${col.id}`,
        label: col.name,
        kind: 'collection',
        collection: col,
        children: reqNodes,
      });
    }

    for (const col of collections.value) {
      const node = map.get(col.id)!;
      if (col.parentId && map.has(col.parentId)) {
        map.get(col.parentId)!.children!.unshift(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  });

  const WORKSPACE_SYNC_TTL_MS = 50 * 60 * 1000;
  let lastWorkspaceSyncAt = 0;
  let lastSyncedUserId = '';
  let authInitialized = false;

  function clearSessionState() {
    user.value = null;
    accessToken.value = null;
    profile.value = null;
    workspaces.value = [];
    activeWorkspaceId.value = '';
    collections.value = [];
    members.value = [];
    monitors.value = [];
    onlinePeers.value = [];
    loadedMembersWsId.value = '';
    loadedMonitorsWsId.value = '';
    lastWorkspaceSyncAt = 0;
    lastSyncedUserId = '';
    needsPasswordSetup.value = false;
    environments.value = loadLocalEnvironments();
    if (
      activeEnvId.value &&
      !environments.value.some((e) => e.id === activeEnvId.value)
    ) {
      activeEnvId.value = '';
    }
  }

  function isUserEmailVerified(u: User | null): boolean {
    if (!u) return false;
    return Boolean(
      u.email_confirmed_at ||
        (u as { confirmed_at?: string | null }).confirmed_at,
    );
  }

  async function maybeSendOAuthSetPasswordEmail(currentUser: User | null) {
    if (!currentUser?.email || !supabase) return;
    const provider = String(currentUser.app_metadata?.provider ?? '').toLowerCase();
    const providers = Array.isArray(currentUser.app_metadata?.providers)
      ? (currentUser.app_metadata.providers as string[]).map((p) =>
          p.toLowerCase(),
        )
      : [];

    const isOAuth =
      ['google', 'github', 'discord'].includes(provider) ||
      providers.some((p) => ['google', 'github', 'discord'].includes(p));
    if (!isOAuth || providers.includes('email')) return;

    const meta = (currentUser.user_metadata ?? {}) as Record<string, unknown>;
    if (meta.has_password === true || meta.set_password_email_sent === true) {
      return;
    }

    const storageKey = `api_open_oauth_pw_email_${currentUser.id}`;
    try {
      if (localStorage.getItem(storageKey)) return;
      localStorage.setItem(storageKey, '1');
    } catch {
      // ignore storage errors
    }

    try {
      await supabase.auth.updateUser({
        data: { set_password_email_sent: true },
      });
      await resetPasswordForEmail(currentUser.email);
    } catch {
      // keep silent if rate-limited or mail fails
    }
  }

  function hasRecoveryInCurrentUrl(): boolean {
    if (typeof window === 'undefined') return false;
    const search = new URLSearchParams(window.location.search);
    const hashRaw = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const hash = new URLSearchParams(hashRaw);
    return (
      search.get('type') === 'recovery' || hash.get('type') === 'recovery'
    );
  }

  async function initAuth() {
    if (!supabase || authInitialized) return;
    authInitialized = true;

    const recoveryFromUrl = hasRecoveryInCurrentUrl();
    const recoveryFromStorage =
      typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem('api_open_password_recovery') === '1';

    if (recoveryFromUrl || recoveryFromStorage) {
      needsPasswordSetup.value = true;
      try {
        sessionStorage.setItem('api_open_password_recovery', '1');
      } catch {
        // ignore
      }
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        needsPasswordSetup.value = true;
        try {
          sessionStorage.setItem('api_open_password_recovery', '1');
        } catch {
          // ignore
        }
      }
      if (event === 'INITIAL_SESSION') return;
      const prevToken = accessToken.value;
      user.value = session?.user ?? null;
      accessToken.value = session?.access_token ?? null;
      if (user.value && !isUserEmailVerified(user.value)) {
        pendingVerificationEmail.value = user.value.email ?? '';
        needsEmailVerification.value = true;
      } else if (user.value && isUserEmailVerified(user.value)) {
        needsEmailVerification.value = false;
        pendingVerificationEmail.value = '';
      }
      if (event === 'TOKEN_REFRESHED' && prevToken && accessToken.value) {
        return;
      }
      if (accessToken.value) {
        const currentUserId = user.value?.id ?? '';
        const isSameUser = Boolean(
          currentUserId && currentUserId === lastSyncedUserId,
        );
        const isWithinTtl =
          lastWorkspaceSyncAt > 0 &&
          Date.now() - lastWorkspaceSyncAt < WORKSPACE_SYNC_TTL_MS;
        if (isSameUser && isWithinTtl && workspaces.value.length > 0) {
          return;
        }
        await loadWorkspaces();
        if (event === 'SIGNED_IN' && !needsPasswordSetup.value) {
          maybeSendOAuthSetPasswordEmail(user.value);
        }
      } else {
        clearSessionState();
      }
    });

    const { data } = await supabase.auth.getSession();
    user.value = data.session?.user ?? null;
    accessToken.value = data.session?.access_token ?? null;
    if (user.value && !isUserEmailVerified(user.value)) {
      pendingVerificationEmail.value = user.value.email ?? '';
      needsEmailVerification.value = true;
    } else {
      needsEmailVerification.value = false;
      pendingVerificationEmail.value = '';
    }
    if (accessToken.value) {
      await loadWorkspaces();
      if (!needsPasswordSetup.value) {
        maybeSendOAuthSetPasswordEmail(user.value);
      }
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (
          document.visibilityState === 'visible' &&
          accessToken.value &&
          lastWorkspaceSyncAt > 0 &&
          Date.now() - lastWorkspaceSyncAt >= WORKSPACE_SYNC_TTL_MS
        ) {
          loadWorkspaces().catch(() => undefined);
        }
      });
    }
  }

  async function signIn(email: string, password: string) {
    if (!supabase) throw new Error('Supabase is not configured');
    const cleanEmail = email.trim();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });
    if (error) {
      const msg = error.message?.toLowerCase() ?? '';
      const code = (error as { code?: string }).code;
      if (msg.includes('email not confirmed') || code === 'email_not_confirmed') {
        pendingVerificationEmail.value = cleanEmail;
        needsEmailVerification.value = true;
        throw new Error('EMAIL_NOT_CONFIRMED');
      }
      throw error;
    }
    if (data.session) {
      user.value = data.session.user;
      accessToken.value = data.session.access_token;
      if (!isUserEmailVerified(data.session.user)) {
        pendingVerificationEmail.value = data.session.user.email ?? cleanEmail;
        needsEmailVerification.value = true;
      } else {
        needsEmailVerification.value = false;
        pendingVerificationEmail.value = '';
      }
      await loadWorkspaces();
    }
  }

  function getDesktopAuthBridge() {
    return (
      window as unknown as {
        apiOpenDesktop?: {
          isDesktop?: boolean;
          openExternal?: (url: string) => Promise<boolean>;
        };
      }
    ).apiOpenDesktop;
  }

  function getAuthRedirectUrl(): string {
    return getDesktopAuthBridge()?.isDesktop
      ? 'apiopen://auth/callback'
      : window.location.origin;
  }

  async function signUp(email: string, password: string) {
    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: getAuthRedirectUrl(),
      },
    });
    workspaceApi.logAuthEmail({
      to: email,
      subject: 'Account Signup Verification',
      category: 'auth_verification',
      status: error ? 'failed' : 'sent',
      error: error?.message,
    });
    if (error) throw error;
  }

  async function signInWithOtp(email: string) {
    const cleanEmail = email.trim();
    const redirectTo = getAuthRedirectUrl();
    const backendResult = await workspaceApi
      .sendMagicLink(cleanEmail, redirectTo)
      .catch(() => null);
    if (backendResult?.handled) return;

    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.auth.signInWithOtp({
      email: cleanEmail,
      options: {
        emailRedirectTo: redirectTo,
        shouldCreateUser: true,
      },
    });
    workspaceApi.logAuthEmail({
      to: cleanEmail,
      subject: 'Email Login Verification Link',
      category: 'auth_magic_link',
      status: error ? 'failed' : 'sent',
      error: error?.message,
    });
    if (error) throw error;
  }

  async function resetPasswordForEmail(email: string) {
    const cleanEmail = email.trim();
    const redirectTo = getAuthRedirectUrl();
    const backendResult = await workspaceApi
      .requestPasswordReset(cleanEmail, redirectTo)
      .catch(() => null);

    if (backendResult?.handled) {
      return;
    }

    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo,
    });
    workspaceApi.logAuthEmail({
      to: cleanEmail,
      subject: 'Set / Reset Password Email',
      category: 'auth_password_reset',
      status: error ? 'failed' : 'sent',
      error: error?.message,
    });
    if (error) throw error;
  }

  async function resendVerification(email: string) {
    const cleanEmail = email.trim();
    const redirectTo = getAuthRedirectUrl();
    const backendResult = await workspaceApi
      .sendVerificationEmail(cleanEmail, redirectTo)
      .catch(() => null);
    if (backendResult?.handled) return;

    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: cleanEmail,
      options: {
        emailRedirectTo: redirectTo,
      },
    });
    workspaceApi.logAuthEmail({
      to: cleanEmail,
      subject: 'Resend Signup Verification Email',
      category: 'auth_verification',
      status: error ? 'failed' : 'sent',
      error: error?.message,
    });
    if (error) throw error;
  }

  async function signInWithOAuth(provider: 'google' | 'github' | 'discord') {
    if (!supabase) throw new Error('Supabase is not configured');
    const desktop = getDesktopAuthBridge();
    const isDesktop = Boolean(desktop?.isDesktop);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: getAuthRedirectUrl(),
        ...(isDesktop ? { skipBrowserRedirect: true } : {}),
      },
    });
    if (error) throw error;
    if (isDesktop && data?.url) {
      if (desktop?.openExternal) {
        await desktop.openExternal(data.url);
      } else {
        window.open(data.url, '_blank', 'noopener');
      }
    }
  }

  async function signInWithSso(domain: string) {
    if (!supabase) throw new Error('Supabase is not configured');
    const desktop = getDesktopAuthBridge();
    const isDesktop = Boolean(desktop?.isDesktop);
    const { data, error } = await supabase.auth.signInWithSSO({
      domain: domain.trim(),
      options: {
        redirectTo: getAuthRedirectUrl(),
      },
    });
    if (error) throw error;
    if (data?.url) {
      if (isDesktop && desktop?.openExternal) {
        await desktop.openExternal(data.url);
      } else {
        window.location.href = data.url;
      }
    }
  }

  async function handleDeepLinkCallback(rawUrl: string) {
    if (!supabase || !rawUrl.startsWith('apiopen://')) return;
    try {
      const parsed = new URL(rawUrl);
      const queryParams = parsed.searchParams;
      const hashRaw = parsed.hash.startsWith('#')
        ? parsed.hash.slice(1)
        : parsed.hash;
      const hashParams = new URLSearchParams(hashRaw);

      const code = queryParams.get('code') || hashParams.get('code');
      const accessToken =
        hashParams.get('access_token') || queryParams.get('access_token');
      const refreshToken =
        hashParams.get('refresh_token') || queryParams.get('refresh_token');
      const type = queryParams.get('type') || hashParams.get('type');

      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
      } else if (accessToken && refreshToken) {
        await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
      }

      if (type === 'recovery') {
        needsPasswordSetup.value = true;
      }
    } catch {
      // ignore malformed deep-link callback
    }
  }

  async function checkEmailVerification(): Promise<boolean> {
    if (!supabase) return false;
    await supabase.auth.refreshSession().catch(() => undefined);
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return false;
    user.value = data.user;
    if (isUserEmailVerified(data.user)) {
      needsEmailVerification.value = false;
      pendingVerificationEmail.value = '';
      await loadWorkspaces();
      return true;
    }
    return false;
  }

  async function signOut() {
    needsEmailVerification.value = false;
    pendingVerificationEmail.value = '';
    clearSessionState();
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
    } catch {
      // local session already cleared
    }
  }

  async function updateEmail(newEmail: string) {
    if (!supabase) throw new Error('Supabase is not configured');
    const cleanEmail = newEmail.trim();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error('Please enter a valid email address');
    }
    const { error } = await supabase.auth.updateUser(
      { email: cleanEmail },
      { emailRedirectTo: getAuthRedirectUrl() },
    );
    if (error) throw error;
  }

  async function signOutAllDevices() {
    needsEmailVerification.value = false;
    pendingVerificationEmail.value = '';
    clearSessionState();
    if (!supabase) return;
    await supabase.auth.signOut({ scope: 'global' });
  }

  async function deleteAccount() {
    const token = accessToken.value;
    if (!token) throw new Error('Not authenticated');
    await workspaceApi.deleteAccount(token);
    await signOut();
  }

  let inFlightWorkspaces: Promise<void> | null = null;
  let inFlightWorkspaceData: Promise<void> | null = null;
  let inFlightCollections: Promise<void> | null = null;
  let inFlightEnvironments: Promise<void> | null = null;
  let inFlightMembers: Promise<void> | null = null;
  let inFlightMonitors: Promise<void> | null = null;
  const loadedMembersWsId = ref('');
  const loadedMonitorsWsId = ref('');

  // Trash / Recycle Bin, Environment Protection, Audit Log, Shared Script, Live Presence
  interface TrashItem {
    id: string;
    kind: 'collection' | 'request' | 'environment';
    name: string;
    deletedAt: string;
    payload: unknown;
  }
  interface AuditEntry {
    id: string;
    actor: string;
    action: string;
    target: string;
    timestamp: string;
  }
  const TRASH_KEY = 'api_open_trash_v1';
  const ENV_LOCK_KEY = 'api_open_env_locks_v1';
  const AUDIT_KEY = 'api_open_audit_logs_v1';
  const SHARED_SCRIPT_KEY = 'api_open_shared_script_v1';

  const trashItems = ref<TrashItem[]>((() => {
    try {
      const raw = localStorage.getItem(TRASH_KEY);
      return raw ? (JSON.parse(raw) as TrashItem[]) : [];
    } catch {
      return [];
    }
  })());
  const protectedEnvIds = ref<string[]>((() => {
    try {
      const raw = localStorage.getItem(ENV_LOCK_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  })());
  const auditLogs = ref<AuditEntry[]>((() => {
    try {
      const raw = localStorage.getItem(AUDIT_KEY);
      return raw ? (JSON.parse(raw) as AuditEntry[]) : [];
    } catch {
      return [];
    }
  })());
  const sharedScript = ref<string>(localStorage.getItem(SHARED_SCRIPT_KEY) ?? '');
  const onlinePeers = ref<Array<{ email: string; name?: string }>>([]);

  watch(trashItems, (v) => {
    try { localStorage.setItem(TRASH_KEY, JSON.stringify(v.slice(0, 100))); } catch { /* ignore */ }
  }, { deep: true });
  watch(protectedEnvIds, (v) => {
    try { localStorage.setItem(ENV_LOCK_KEY, JSON.stringify(v)); } catch { /* ignore */ }
  }, { deep: true });
  watch(auditLogs, (v) => {
    try { localStorage.setItem(AUDIT_KEY, JSON.stringify(v.slice(0, 200))); } catch { /* ignore */ }
  }, { deep: true });
  watch(sharedScript, (v) => {
    try { localStorage.setItem(SHARED_SCRIPT_KEY, v); } catch { /* ignore */ }
  });

  function recordAudit(action: string, target: string) {
    auditLogs.value.unshift({
      id: Math.random().toString(36).slice(2, 10),
      actor: user.value?.email ?? profile.value?.name ?? 'Local User',
      action,
      target,
      timestamp: new Date().toISOString(),
    });
  }

  function toggleEnvProtection(envId: string) {
    if (currentUserRole.value !== 'OWNER') {
      throw new Error('Only workspace OWNER can lock/unlock environments');
    }
    if (protectedEnvIds.value.includes(envId)) {
      protectedEnvIds.value = protectedEnvIds.value.filter((id) => id !== envId);
      recordAudit('Unlocked Environment', envId);
    } else {
      protectedEnvIds.value = [...protectedEnvIds.value, envId];
      recordAudit('Locked Environment (OWNER only)', envId);
    }
  }

  async function restoreTrashItem(trashId: string) {
    const idx = trashItems.value.findIndex((t) => t.id === trashId);
    if (idx < 0) return;
    const item = trashItems.value[idx];
    if (item.kind === 'environment') {
      const env = item.payload as EnvironmentDto;
      await createEnvironment(env.name, env.variables ?? []);
    } else if (item.kind === 'collection') {
      const col = item.payload as CollectionDto;
      await createCollection(col.name, col.parentId ?? undefined);
    } else if (item.kind === 'request' && accessToken.value) {
      const req = item.payload as ApiRequestDto;
      await workspaceApi.createRequest(accessToken.value, req.collectionId, {
        name: req.name,
        method: req.method,
        url: req.url,
        headers: req.headers,
        queryParams: req.queryParams,
        pathParams: req.pathParams ?? [],
        auth: req.auth,
        body: req.body,
        examples: req.examples ?? [],
        preRequestScript: req.preRequestScript,
        testScript: req.testScript,
      });
      await refreshCollections();
    }
    trashItems.value.splice(idx, 1);
    recordAudit(`Restored ${item.kind}`, item.name);
  }

  function emptyTrash() {
    trashItems.value = [];
  }

  let userNotifyChannel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;
  watch(
    () => user.value?.email,
    (email) => {
      if (userNotifyChannel && supabase) {
        supabase.removeChannel(userNotifyChannel);
        userNotifyChannel = null;
      }
      if (!supabase || !email) return;
      const ch = supabase.channel(`user-notify:${email.toLowerCase()}`);
      ch.on(
        'broadcast',
        { event: 'workspace_invite' },
        (msg: {
          payload?: {
            workspaceId?: string;
            workspaceName?: string;
            role?: string;
            inviterLabel?: string;
          };
        }) => {
          const p = msg.payload ?? {};
          const text = `${p.inviterLabel || 'A teammate'} invited you as ${p.role || 'EDITOR'} to workspace "${p.workspaceName || 'Workspace'}"`;
          ElNotification({
            title: 'Workspace Invitation',
            message: text,
            type: 'success',
            duration: 6000,
          });
          useConsoleStore().addLog({
            type: 'activity',
            message: text,
          });
          loadWorkspaces().catch(() => undefined);
        },
      ).subscribe();
      userNotifyChannel = ch;
    },
    { immediate: true },
  );

  let presenceChannel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;
  watch(
    () => [activeWorkspaceId.value, user.value?.email] as const,
    ([wsId, email]) => {
      if (presenceChannel && supabase) {
        supabase.removeChannel(presenceChannel);
        presenceChannel = null;
      }
      if (!supabase || !wsId || !email) {
        onlinePeers.value = email ? [{ email, name: profile.value?.name ?? undefined }] : [];
        return;
      }
      const ch = supabase.channel(`ws:${wsId}`, {
        config: { presence: { key: email } },
      });
      ch.on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState<{ email: string; name?: string }>();
        const list: Array<{ email: string; name?: string }> = [];
        for (const entries of Object.values(state)) {
          if (entries[0]) list.push(entries[0]);
        }
        onlinePeers.value = list;
      }).subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await ch.track({ email, name: profile.value?.name });
        }
      });
      presenceChannel = ch;
    },
    { immediate: true },
  );

  async function loadWorkspaces() {
    if (!accessToken.value) return;
    if (inFlightWorkspaces) return inFlightWorkspaces;
    inFlightWorkspaces = (async () => {
      loadingData.value = true;
      try {
        const storedWsId = activeWorkspaceId.value;
        const [wsList, prof] = await Promise.all([
          workspaceApi.listWorkspaces(accessToken.value!),
          workspaceApi.getProfile(accessToken.value!),
        ]);
        workspaces.value = wsList;
        profile.value = prof;
        const metaAvatar =
          (user.value?.user_metadata?.avatar_url as string | undefined) ||
          (user.value?.user_metadata?.picture as string | undefined);
        if (prof && !prof.avatarUrl && metaAvatar) {
          profile.value = { ...prof, avatarUrl: metaAvatar };
          workspaceApi
            .updateProfile(accessToken.value!, { avatarUrl: metaAvatar })
            .catch(() => undefined);
        }
        const hasValidStored =
          storedWsId && workspaces.value.some((w) => w.id === storedWsId);
        if (hasValidStored) {
          await loadWorkspaceData(storedWsId);
        } else if (workspaces.value.length) {
          activeWorkspaceId.value = workspaces.value[0].id;
          await loadWorkspaceData(activeWorkspaceId.value);
        } else {
          activeWorkspaceId.value = '';
          collections.value = [];
        }
        lastWorkspaceSyncAt = Date.now();
        lastSyncedUserId = user.value?.id ?? '';
      } finally {
        loadingData.value = false;
        inFlightWorkspaces = null;
      }
    })();
    return inFlightWorkspaces;
  }

  async function updateProfile(payload: {
    name?: string;
    avatarUrl?: string | null;
  }) {
    if (!accessToken.value) return;
    profile.value = await workspaceApi.updateProfile(accessToken.value, payload);
  }

  async function updatePassword(newPassword: string) {
    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
      data: { has_password: true },
    });
    if (error) throw error;
    needsPasswordSetup.value = false;
    try {
      sessionStorage.removeItem('api_open_password_recovery');
    } catch {
      // ignore
    }
  }

  async function refreshCollections(workspaceId = activeWorkspaceId.value) {
    if (!accessToken.value || !workspaceId) return;
    if (inFlightCollections) return inFlightCollections;
    inFlightCollections = withBusy(async () => {
      try {
        collections.value = await workspaceApi.listCollections(
          accessToken.value!,
          workspaceId,
        );
      } finally {
        inFlightCollections = null;
      }
    });
    return inFlightCollections;
  }

  async function refreshEnvironments(workspaceId = activeWorkspaceId.value) {
    if (!accessToken.value || !workspaceId) return;
    if (inFlightEnvironments) return inFlightEnvironments;
    inFlightEnvironments = withBusy(async () => {
      try {
        const envs = await workspaceApi.listEnvironments(
          accessToken.value!,
          workspaceId,
        );
        environments.value = envs;
        if (
          activeEnvId.value &&
          !envs.some((e) => e.id === activeEnvId.value)
        ) {
          activeEnvId.value = '';
        }
      } finally {
        inFlightEnvironments = null;
      }
    });
    return inFlightEnvironments;
  }

  async function loadWorkspaceData(workspaceId: string) {
    if (!accessToken.value || !workspaceId) return;
    if (inFlightWorkspaceData) return inFlightWorkspaceData;
    inFlightWorkspaceData = (async () => {
      try {
        await Promise.all([
          refreshCollections(workspaceId),
          refreshEnvironments(workspaceId),
        ]);
        loadedMembersWsId.value = '';
        loadedMonitorsWsId.value = '';
      } finally {
        inFlightWorkspaceData = null;
      }
    })();
    return inFlightWorkspaceData;
  }

  async function ensureMembersLoaded(force = false) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    const wsId = activeWorkspaceId.value;
    if (!force && loadedMembersWsId.value === wsId) return;
    if (inFlightMembers) return inFlightMembers;
    inFlightMembers = (async () => {
      try {
        members.value = await workspaceApi.listMembers(accessToken.value!, wsId);
        loadedMembersWsId.value = wsId;
      } finally {
        inFlightMembers = null;
      }
    })();
    return inFlightMembers;
  }

  async function ensureMonitorsLoaded(force = false) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    const wsId = activeWorkspaceId.value;
    if (!force && loadedMonitorsWsId.value === wsId) return;
    if (inFlightMonitors) return inFlightMonitors;
    inFlightMonitors = (async () => {
      try {
        monitors.value = await workspaceApi
          .listMonitors(accessToken.value!, wsId)
          .catch(() => []);
        loadedMonitorsWsId.value = wsId;
      } finally {
        inFlightMonitors = null;
      }
    })();
    return inFlightMonitors;
  }

  async function createTeamWorkspace(name: string) {
    if (!accessToken.value) return;
    const created = await workspaceApi.createWorkspace(accessToken.value, name);
    await loadWorkspaces();
    activeWorkspaceId.value = created.id;
    await loadWorkspaceData(created.id);
  }

  async function deleteWorkspace(workspaceId: string) {
    if (!accessToken.value) return;
    await workspaceApi.deleteWorkspace(accessToken.value, workspaceId);
    const wasActive = activeWorkspaceId.value === workspaceId;
    workspaces.value = workspaces.value.filter((w) => w.id !== workspaceId);
    if (wasActive || workspaces.value.length === 0) {
      if (wasActive) {
        activeWorkspaceId.value = '';
        collections.value = [];
        environments.value = [];
      }
      await loadWorkspaces();
    }
  }

  async function updateWorkspaceMeta(payload: {
    name?: string;
    summary?: string;
    readme?: string;
  }) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    const updated = await workspaceApi.updateWorkspace(
      accessToken.value,
      activeWorkspaceId.value,
      payload,
    );
    workspaces.value = workspaces.value.map((w) =>
      w.id === updated.id ? { ...w, ...updated } : w,
    );
  }

  async function inviteMember(
    email: string,
    role: 'OWNER' | 'EDITOR' | 'VIEWER' = 'EDITOR',
  ) {
    if (!accessToken.value || !activeWorkspaceId.value) {
      throw new Error('Sign in first');
    }
    const res = await workspaceApi.inviteMember(
      accessToken.value,
      activeWorkspaceId.value,
      email,
      role,
    );
    if (res.addedImmediately && supabase) {
      const ch = supabase.channel(`user-notify:${res.email.toLowerCase()}`);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          ch.send({
            type: 'broadcast',
            event: 'workspace_invite',
            payload: {
              workspaceId: activeWorkspaceId.value,
              workspaceName: res.workspaceName,
              role: res.role,
              inviterLabel: res.inviterLabel,
            },
          }).finally(() => {
            supabase?.removeChannel(ch);
          });
        }
      });
    }
    await ensureMembersLoaded(true);
    return res;
  }

  async function removeMember(memberId: string) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    await workspaceApi.removeMember(
      accessToken.value,
      activeWorkspaceId.value,
      memberId,
    );
    await ensureMembersLoaded(true);
  }

  async function updateMemberRole(
    memberId: string,
    role: 'OWNER' | 'EDITOR' | 'VIEWER',
  ) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    await workspaceApi.updateMemberRole(
      accessToken.value,
      activeWorkspaceId.value,
      memberId,
      role,
    );
    await ensureMembersLoaded(true);
  }

  async function createCollection(name: string, parentId?: string) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    await workspaceApi.createCollection(
      accessToken.value,
      activeWorkspaceId.value,
      name,
      parentId,
    );
    await refreshCollections();
  }

  async function updateCollection(
    id: string,
    payload: {
      name?: string;
      parentId?: string | null;
      order?: number;
      auth?: AuthConfig;
      headers?: KeyValueItem[];
      variables?: EnvVariable[];
    },
  ) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    await workspaceApi.updateCollection(accessToken.value, id, payload);
    await refreshCollections();
  }

  async function moveOrReorderRequest(
    requestId: string,
    targetCollectionId: string,
    order: number,
  ) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    await workspaceApi.updateRequest(accessToken.value, requestId, {
      collectionId: targetCollectionId,
      order,
    });
    await refreshCollections();
  }

  async function moveOrReorderCollection(
    collectionId: string,
    parentId: string | null,
    order: number,
  ) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    await workspaceApi.updateCollection(accessToken.value, collectionId, {
      parentId,
      order,
    });
    await refreshCollections();
  }

  async function createMonitor(payload: {
    collectionId: string;
    name: string;
    intervalMinutes: number;
  }) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    await workspaceApi.createMonitor(
      accessToken.value,
      activeWorkspaceId.value,
      payload,
    );
    monitors.value = await workspaceApi.listMonitors(
      accessToken.value,
      activeWorkspaceId.value,
    );
  }

  async function toggleMonitor(id: string, enabled: boolean) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    await workspaceApi.updateMonitor(accessToken.value, id, { enabled });
    monitors.value = await workspaceApi.listMonitors(
      accessToken.value,
      activeWorkspaceId.value,
    );
  }

  async function runMonitorNow(id: string) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    await workspaceApi.runMonitor(accessToken.value, id);
    monitors.value = await workspaceApi.listMonitors(
      accessToken.value,
      activeWorkspaceId.value,
    );
  }

  async function deleteMonitor(id: string) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    await workspaceApi.deleteMonitor(accessToken.value, id);
    monitors.value = await workspaceApi.listMonitors(
      accessToken.value,
      activeWorkspaceId.value,
    );
  }

  async function duplicateCollection(id: string) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    await workspaceApi.duplicateCollection(accessToken.value, id);
    await refreshCollections();
  }

  async function deleteCollection(id: string) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    const found = collections.value.find((c) => c.id === id);
    if (found) {
      trashItems.value.unshift({
        id: Math.random().toString(36).slice(2, 10),
        kind: 'collection',
        name: found.name,
        deletedAt: new Date().toISOString(),
        payload: found,
      });
      recordAudit('Deleted Collection', found.name);
    }
    await workspaceApi.deleteCollection(accessToken.value, id);
    await refreshCollections();
  }

  async function renameRequest(id: string, name: string) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    await workspaceApi.updateRequest(accessToken.value, id, { name: name.trim() });
    await refreshCollections();
  }

  async function duplicateRequest(req: ApiRequestDto) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    await workspaceApi.createRequest(accessToken.value, req.collectionId, {
      name: `${req.name} Copy`,
      method: req.method,
      url: req.url,
      headers: req.headers,
      queryParams: req.queryParams,
      pathParams: req.pathParams ?? [],
      auth: req.auth,
      body: req.body,
      examples: req.examples ?? [],
      preRequestScript: req.preRequestScript,
      testScript: req.testScript,
    });
    await refreshCollections();
  }

  async function deleteRequest(id: string) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    const found = collections.value.flatMap((c) => c.requests ?? []).find((r) => r.id === id);
    if (found) {
      trashItems.value.unshift({
        id: Math.random().toString(36).slice(2, 10),
        kind: 'request',
        name: `${found.method} ${found.name}`,
        deletedAt: new Date().toISOString(),
        payload: found,
      });
      recordAudit('Deleted Request', found.name);
    }
    await workspaceApi.deleteRequest(accessToken.value, id);
    await refreshCollections();
  }

  function getEffectiveCollectionAuthAndHeaders(collectionId?: string): {
    auth: AuthConfig;
    headers: KeyValueItem[];
    variables: Record<string, string>;
    sourceCollectionName?: string;
  } {
    if (!collectionId) return { auth: { type: 'none' }, headers: [], variables: {} };
    const chain: CollectionDto[] = [];
    const visited = new Set<string>();
    let currentId: string | null = collectionId;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const col = collections.value.find((c) => c.id === currentId);
      if (!col) break;
      chain.unshift(col);
      currentId = col.parentId;
    }

    const mergedHeaders: KeyValueItem[] = [];
    const mergedVariables: Record<string, string> = {};
    let resolvedAuth: AuthConfig = { type: 'none' };
    let sourceCollectionName: string | undefined;

    for (const col of chain) {
      if (col.headers?.length) {
        for (const h of col.headers) {
          if (h.enabled && h.key.trim()) mergedHeaders.push(h);
        }
      }
      if (col.variables?.length) {
        for (const v of col.variables) {
          if (v.enabled && v.key.trim()) mergedVariables[v.key.trim()] = v.value ?? '';
        }
      }
      if (col.auth && col.auth.type !== 'none' && col.auth.type !== 'inherit') {
        resolvedAuth = col.auth;
        sourceCollectionName = col.name;
      }
    }

    return {
      auth: resolvedAuth,
      headers: mergedHeaders,
      variables: mergedVariables,
      sourceCollectionName,
    };
  }

  async function createEnvironment(name: string, variables: EnvVariable[] = []) {
    if (!accessToken.value || !activeWorkspaceId.value) {
      const localEnv: EnvironmentDto = {
        id: `local-${Math.random().toString(36).slice(2, 10)}`,
        workspaceId: 'local',
        name: name.trim(),
        isGlobal: false,
        variables,
      };
      environments.value = [...environments.value, localEnv];
      saveLocalEnvironments(environments.value);
      activeEnvId.value = localEnv.id;
      return;
    }
    const created = await workspaceApi.createEnvironment(
      accessToken.value,
      activeWorkspaceId.value,
      name,
      variables,
    );
    await refreshEnvironments();
    activeEnvId.value = created.id;
  }

  async function updateEnvironment(
    id: string,
    payload: { name?: string; variables?: EnvVariable[] },
  ) {
    if (protectedEnvIds.value.includes(id) && currentUserRole.value !== 'OWNER') {
      throw new Error('This environment is protected. Only OWNER can modify it.');
    }
    recordAudit('Updated Environment', payload.name ?? id);
    if (!accessToken.value || !activeWorkspaceId.value) {
      environments.value = environments.value.map((env) =>
        env.id === id
          ? {
              ...env,
              ...(payload.name !== undefined ? { name: payload.name } : {}),
              ...(payload.variables !== undefined
                ? { variables: payload.variables }
                : {}),
            }
          : env,
      );
      saveLocalEnvironments(environments.value);
      return;
    }
    await workspaceApi.updateEnvironment(accessToken.value, id, payload);
    await refreshEnvironments();
  }

  async function deleteEnvironment(id: string) {
    if (protectedEnvIds.value.includes(id) && currentUserRole.value !== 'OWNER') {
      throw new Error('This environment is protected. Only OWNER can delete it.');
    }
    const found = environments.value.find((e) => e.id === id);
    if (found) {
      trashItems.value.unshift({
        id: Math.random().toString(36).slice(2, 10),
        kind: 'environment',
        name: found.name,
        deletedAt: new Date().toISOString(),
        payload: found,
      });
      recordAudit('Deleted Environment', found.name);
    }
    if (!accessToken.value || !activeWorkspaceId.value) {
      environments.value = environments.value.filter((env) => env.id !== id);
      saveLocalEnvironments(environments.value);
      if (activeEnvId.value === id) activeEnvId.value = '';
      return;
    }
    await workspaceApi.deleteEnvironment(accessToken.value, id);
    if (activeEnvId.value === id) activeEnvId.value = '';
    await refreshEnvironments();
  }

  function mergeImportedFolderInto(
    targetFolders: ImportedCollectionNode[],
    folder: ImportedCollectionNode,
  ) {
    const segments = folder.name
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);
    const pathSegments = segments.length ? segments : ['Folder'];

    let currentList = targetFolders;
    let leaf: ImportedCollectionNode | null = null;
    for (const seg of pathSegments) {
      let existing = currentList.find((f) => f.name === seg);
      if (!existing) {
        existing = { name: seg, folders: [], requests: [] };
        currentList.push(existing);
      }
      leaf = existing;
      currentList = existing.folders;
    }

    if (leaf) {
      leaf.requests.push(...folder.requests);
      for (const sub of folder.folders) {
        mergeImportedFolderInto(leaf.folders, sub);
      }
    }
  }

  function normalizeImportedTree(
    node: ImportedCollectionNode,
  ): ImportedCollectionNode {
    const mergedFolders: ImportedCollectionNode[] = [];
    for (const folder of node.folders) {
      mergeImportedFolderInto(mergedFolders, folder);
    }
    return {
      name: node.name,
      requests: [...node.requests],
      folders: mergedFolders,
    };
  }

  function countImportedItems(node: ImportedCollectionNode): number {
    let count = 1 + node.requests.length;
    for (const sub of node.folders) {
      count += countImportedItems(sub);
    }
    return count;
  }

  async function saveImportedNode(
    node: ImportedCollectionNode,
    parentId?: string,
  ) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    await withBusy(async () => {
      const createdCol = await workspaceApi.createCollection(
        accessToken.value!,
        activeWorkspaceId.value,
        node.name,
        parentId,
      );
      advanceOperationProgress(`Folder: ${node.name}`);
      for (const req of node.requests) {
        await workspaceApi.createRequest(accessToken.value!, createdCol.id, req);
        advanceOperationProgress(`${req.method} ${req.name}`);
      }
      for (const sub of node.folders) {
        await saveImportedNode(sub, createdCol.id);
      }
    });
  }

  async function runImportWithProgress(
    label: string,
    rootNode: ImportedCollectionNode,
    targetParentId?: string,
  ) {
    const totalSteps = countImportedItems(rootNode) + 1;
    startOperationProgress(label, totalSteps);
    try {
      await saveImportedNode(rootNode, targetParentId);
      advanceOperationProgress('Refreshing collections...', 0);
      await refreshCollections();
      finishOperationProgress();
    } catch (err) {
      resetOperationProgress();
      throw err;
    }
  }

  async function importPostmanJson(jsonText: string) {
    if (!accessToken.value || !activeWorkspaceId.value) {
      throw new Error('Sign in first to import collections');
    }
    const root = normalizeImportedTree(parsePostmanCollection(jsonText));
    await runImportWithProgress(`Importing ${root.name}`, root);
  }

  async function importOpenApiJson(specText: string) {
    if (!accessToken.value || !activeWorkspaceId.value) {
      throw new Error('Sign in first to import OpenAPI spec');
    }
    const root = normalizeImportedTree(parseOpenApiSpec(specText));
    await runImportWithProgress(`Importing ${root.name}`, root);
  }

  async function importInsomniaJson(jsonText: string) {
    if (!accessToken.value || !activeWorkspaceId.value) {
      throw new Error('Sign in first to import Insomnia collection');
    }
    const root = normalizeImportedTree(parseInsomniaExport(jsonText));
    await runImportWithProgress(`Importing ${root.name}`, root);
  }

  async function importHarJson(jsonText: string) {
    if (!accessToken.value || !activeWorkspaceId.value) {
      throw new Error('Sign in first to import HAR file');
    }
    const root = normalizeImportedTree(parseHarExport(jsonText));
    await runImportWithProgress(`Importing ${root.name}`, root);
  }

  async function importUniversalCollection(
    rawText: string,
    fileName?: string,
    targetParentId?: string,
  ): Promise<{ name: string; format: string }> {
    if (!accessToken.value || !activeWorkspaceId.value) {
      throw new Error('Sign in first to import collections');
    }
    const { node, format } = parseUniversalCollection(rawText, fileName);
    const normalized = normalizeImportedTree(node);
    await runImportWithProgress(
      `Importing ${normalized.name}`,
      normalized,
      targetParentId,
    );
    return { name: normalized.name, format };
  }

  return {
    user,
    profile,
    accessToken,
    isAuthenticated,
    currentUserRole,
    canEdit,
    workspaces,
    activeWorkspaceId,
    collections,
    collectionTree,
    environments,
    members,
    monitors,
    isOnline,
    offlineQueue,
    schemas,
    flushOfflineQueue,
    activeEnvId,
    activeVariablesMap,
    loadingData,
    isBusy,
    withBusy,
    operationProgress,
    startOperationProgress,
    advanceOperationProgress,
    finishOperationProgress,
    resetOperationProgress,
    needsPasswordSetup,
    needsEmailVerification,
    pendingVerificationEmail,
    initAuth,
    signIn,
    signUp,
    signInWithOtp,
    resetPasswordForEmail,
    signOutAllDevices,
    updateEmail,
    deleteAccount,
    handleDeepLinkCallback,
    resendVerification,
    checkEmailVerification,
    signInWithOAuth,
    signInWithSso,
    signOut,
    loadWorkspaces,
    loadWorkspaceData,
    refreshCollections,
    refreshEnvironments,
    ensureMembersLoaded,
    ensureMonitorsLoaded,
    updateProfile,
    updatePassword,
    createTeamWorkspace,
    deleteWorkspace,
    updateWorkspaceMeta,
    inviteMember,
    updateMemberRole,
    removeMember,
    createCollection,
    updateCollection,
    duplicateCollection,
    deleteCollection,
    renameRequest,
    duplicateRequest,
    deleteRequest,
    moveOrReorderRequest,
    moveOrReorderCollection,
    createMonitor,
    toggleMonitor,
    runMonitorNow,
    deleteMonitor,
    getEffectiveCollectionAuthAndHeaders,
    createEnvironment,
    updateEnvironment,
    deleteEnvironment,
    importPostmanJson,
    importOpenApiJson,
    importInsomniaJson,
    importHarJson,
    importUniversalCollection,
    trashItems,
    protectedEnvIds,
    auditLogs,
    sharedScript,
    onlinePeers,
    recordAudit,
    toggleEnvProtection,
    restoreTrashItem,
    emptyTrash,
  };
});
