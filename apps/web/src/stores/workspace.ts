import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { User } from '@supabase/supabase-js';
import type { EnvVariable } from '@api-open/shared';
import { supabase } from '../lib/supabase';
import {
  type ApiRequestDto,
  type CollectionDto,
  type EnvironmentDto,
  type WorkspaceDto,
  workspaceApi,
} from '../api/workspace';
import {
  type ImportedCollectionNode,
  parsePostmanCollection,
} from '../utils/postmanConverter';

export interface CollectionTreeNode {
  id: string;
  label: string;
  kind: 'collection' | 'request';
  collection?: CollectionDto;
  request?: ApiRequestDto;
  children?: CollectionTreeNode[];
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const user = ref<User | null>(null);
  const accessToken = ref<string | null>(null);
  const workspaces = ref<WorkspaceDto[]>([]);
  const activeWorkspaceId = ref<string>('');
  const collections = ref<CollectionDto[]>([]);
  const environments = ref<EnvironmentDto[]>([]);
  const activeEnvId = ref<string>('');
  const loadingData = ref(false);

  const isAuthenticated = computed(() => Boolean(accessToken.value && user.value));

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

    supabase.auth.onAuthStateChange(async (_event, session) => {
      user.value = session?.user ?? null;
      accessToken.value = session?.access_token ?? null;
      if (accessToken.value) {
        await loadWorkspaces();
      } else {
        workspaces.value = [];
        activeWorkspaceId.value = '';
        collections.value = [];
        environments.value = [];
        activeEnvId.value = '';
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
    const { error } = await supabase.auth.signUp({ email, password });
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

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  async function loadWorkspaces() {
    if (!accessToken.value) return;
    loadingData.value = true;
    try {
      workspaces.value = await workspaceApi.listWorkspaces(accessToken.value);
      if (
        workspaces.value.length &&
        !workspaces.value.some((w) => w.id === activeWorkspaceId.value)
      ) {
        activeWorkspaceId.value = workspaces.value[0].id;
      }
      if (activeWorkspaceId.value) {
        await loadWorkspaceData(activeWorkspaceId.value);
      }
    } finally {
      loadingData.value = false;
    }
  }

  async function loadWorkspaceData(workspaceId: string) {
    if (!accessToken.value || !workspaceId) return;
    const [cols, envs] = await Promise.all([
      workspaceApi.listCollections(accessToken.value, workspaceId),
      workspaceApi.listEnvironments(accessToken.value, workspaceId),
    ]);
    collections.value = cols;
    environments.value = envs;
  }

  async function createCollection(name: string, parentId?: string) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    await workspaceApi.createCollection(
      accessToken.value,
      activeWorkspaceId.value,
      name,
      parentId,
    );
    await loadWorkspaceData(activeWorkspaceId.value);
  }

  async function deleteCollection(id: string) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    await workspaceApi.deleteCollection(accessToken.value, id);
    await loadWorkspaceData(activeWorkspaceId.value);
  }

  async function deleteRequest(id: string) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    await workspaceApi.deleteRequest(accessToken.value, id);
    await loadWorkspaceData(activeWorkspaceId.value);
  }

  async function createEnvironment(name: string, variables: EnvVariable[] = []) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    const created = await workspaceApi.createEnvironment(
      accessToken.value,
      activeWorkspaceId.value,
      name,
      variables,
    );
    await loadWorkspaceData(activeWorkspaceId.value);
    activeEnvId.value = created.id;
  }

  async function updateEnvironment(
    id: string,
    payload: { name?: string; variables?: EnvVariable[] },
  ) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    await workspaceApi.updateEnvironment(accessToken.value, id, payload);
    await loadWorkspaceData(activeWorkspaceId.value);
  }

  async function deleteEnvironment(id: string) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    await workspaceApi.deleteEnvironment(accessToken.value, id);
    if (activeEnvId.value === id) activeEnvId.value = '';
    await loadWorkspaceData(activeWorkspaceId.value);
  }

  async function saveImportedNode(
    node: ImportedCollectionNode,
    parentId?: string,
  ) {
    if (!accessToken.value || !activeWorkspaceId.value) return;
    const createdCol = await workspaceApi.createCollection(
      accessToken.value,
      activeWorkspaceId.value,
      node.name,
      parentId,
    );
    for (const req of node.requests) {
      await workspaceApi.createRequest(accessToken.value, createdCol.id, req);
    }
    for (const sub of node.folders) {
      await saveImportedNode(sub, createdCol.id);
    }
  }

  async function importPostmanJson(jsonText: string) {
    if (!accessToken.value || !activeWorkspaceId.value) {
      throw new Error('Sign in first to import collections');
    }
    const root = parsePostmanCollection(jsonText);
    await saveImportedNode(root);
    await loadWorkspaceData(activeWorkspaceId.value);
  }

  return {
    user,
    accessToken,
    isAuthenticated,
    workspaces,
    activeWorkspaceId,
    collections,
    collectionTree,
    environments,
    activeEnvId,
    activeVariablesMap,
    loadingData,
    initAuth,
    signIn,
    signUp,
    signInWithOAuth,
    signOut,
    loadWorkspaces,
    loadWorkspaceData,
    createCollection,
    deleteCollection,
    deleteRequest,
    createEnvironment,
    updateEnvironment,
    deleteEnvironment,
    importPostmanJson,
  };
});
