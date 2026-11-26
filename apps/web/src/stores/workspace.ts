import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { User } from '@supabase/supabase-js';
import type { AuthConfig, EnvVariable, KeyValueItem } from '@api-open/shared';
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

  async function initAuth() {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    user.value = data.session?.user ?? null;
    accessToken.value = data.session?.access_token ?? null;
    if (accessToken.value) {
      await loadWorkspaces();
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION') return;
      if (event === 'PASSWORD_RECOVERY') {
        needsPasswordSetup.value = true;
      }
      const prevToken = accessToken.value;
      user.value = session?.user ?? null;
      accessToken.value = session?.access_token ?? null;
      if (event === 'TOKEN_REFRESHED' && prevToken && accessToken.value) {
        return;
      }
      if (accessToken.value) {
        await loadWorkspaces();
      } else {
        profile.value = null;
        workspaces.value = [];
        activeWorkspaceId.value = '';
        collections.value = [];
        members.value = [];
        monitors.value = [];
        loadedMembersWsId.value = '';
        loadedMonitorsWsId.value = '';
        environments.value = loadLocalEnvironments();
        if (
          activeEnvId.value &&
          !environments.value.some((e) => e.id === activeEnvId.value)
        ) {
          activeEnvId.value = '';
        }
      }
    });
  }

  async function signIn(email: string, password: string) {
    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signUp(email: string, password: string) {
    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
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
    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
        shouldCreateUser: true,
      },
    });
    workspaceApi.logAuthEmail({
      to: email,
      subject: 'Email Login Verification Link',
      category: 'auth_magic_link',
      status: error ? 'failed' : 'sent',
      error: error?.message,
    });
    if (error) throw error;
  }

  async function resetPasswordForEmail(email: string) {
    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    workspaceApi.logAuthEmail({
      to: email,
      subject: 'Set / Reset Password Email',
      category: 'auth_password_reset',
      status: error ? 'failed' : 'sent',
      error: error?.message,
    });
    if (error) throw error;
  }

  async function resendVerification(email: string) {
    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });
    workspaceApi.logAuthEmail({
      to: email,
      subject: 'Resend Signup Verification Email',
      category: 'auth_verification',
      status: error ? 'failed' : 'sent',
      error: error?.message,
    });
    if (error) throw error;
  }

  async function signInWithOAuth(provider: 'google' | 'github' | 'discord') {
    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) throw error;
  }

  async function signInWithSso(domain: string) {
    if (!supabase) throw new Error('Supabase is not configured');
    const { data, error } = await supabase.auth.signInWithSSO({
      domain: domain.trim(),
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) throw error;
    if (data?.url) {
      window.location.href = data.url;
    }
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
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
          storedWsId ? loadWorkspaceData(storedWsId) : Promise.resolve(),
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
        if (workspaces.value.length && !hasValidStored) {
          activeWorkspaceId.value = workspaces.value[0].id;
          await loadWorkspaceData(activeWorkspaceId.value);
        } else if (!storedWsId && activeWorkspaceId.value) {
          await loadWorkspaceData(activeWorkspaceId.value);
        }
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
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    needsPasswordSetup.value = false;
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
      for (const req of node.requests) {
        await workspaceApi.createRequest(accessToken.value!, createdCol.id, req);
      }
      for (const sub of node.folders) {
        await saveImportedNode(sub, createdCol.id);
      }
    });
  }

  async function importPostmanJson(jsonText: string) {
    if (!accessToken.value || !activeWorkspaceId.value) {
      throw new Error('Sign in first to import collections');
    }
    const root = parsePostmanCollection(jsonText);
    await saveImportedNode(root);
    await refreshCollections();
  }

  async function importOpenApiJson(specText: string) {
    if (!accessToken.value || !activeWorkspaceId.value) {
      throw new Error('Sign in first to import OpenAPI spec');
    }
    const root = parseOpenApiSpec(specText);
    await saveImportedNode(root);
    await refreshCollections();
  }

  async function importInsomniaJson(jsonText: string) {
    if (!accessToken.value || !activeWorkspaceId.value) {
      throw new Error('Sign in first to import Insomnia collection');
    }
    const root = parseInsomniaExport(jsonText);
    await saveImportedNode(root);
    await refreshCollections();
  }

  async function importHarJson(jsonText: string) {
    if (!accessToken.value || !activeWorkspaceId.value) {
      throw new Error('Sign in first to import HAR file');
    }
    const root = parseHarExport(jsonText);
    await saveImportedNode(root);
    await refreshCollections();
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
    await saveImportedNode(node, targetParentId);
    await refreshCollections();
    return { name: node.name, format };
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
    needsPasswordSetup,
    initAuth,
    signIn,
    signUp,
    signInWithOtp,
    resetPasswordForEmail,
    resendVerification,
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
