import type {
  AuthConfig,
  BodyConfig,
  EnvVariable,
  HttpMethod,
  KeyValueItem,
} from '@api-open/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export interface WorkspaceDto {
  id: string;
  name: string;
  type: 'PERSONAL' | 'TEAM';
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
}

export interface WorkspaceMemberDto {
  id: string;
  workspaceId: string;
  userId: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  user: {
    id: string;
    email: string;
    name?: string | null;
    avatarUrl?: string | null;
  };
}

export interface ApiRequestDto {
  id: string;
  collectionId: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValueItem[];
  queryParams: KeyValueItem[];
  auth: AuthConfig;
  body: BodyConfig;
  preRequestScript?: string | null;
  testScript?: string | null;
}

export interface CollectionDto {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  requests: ApiRequestDto[];
}

export interface EnvironmentDto {
  id: string;
  workspaceId: string;
  name: string;
  isGlobal: boolean;
  variables: EnvVariable[];
}

async function apiFetch<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    let msg = `API error ${res.status}`;
    try {
      const err = await res.json();
      if (err?.message) {
        msg = Array.isArray(err.message) ? err.message.join(', ') : err.message;
      }
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return res.json() as Promise<T>;
}

export const workspaceApi = {
  listWorkspaces: (token: string) =>
    apiFetch<WorkspaceDto[]>('/workspaces', token),

  createWorkspace: (token: string, name: string) =>
    apiFetch<WorkspaceDto>('/workspaces', token, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  listMembers: (token: string, workspaceId: string) =>
    apiFetch<WorkspaceMemberDto[]>(`/workspaces/${workspaceId}/members`, token),

  inviteMember: (
    token: string,
    workspaceId: string,
    email: string,
    role: 'OWNER' | 'EDITOR' | 'VIEWER',
  ) =>
    apiFetch<{ addedImmediately: boolean; emailSent: boolean; email: string }>(
      `/workspaces/${workspaceId}/invite`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      },
    ),

  removeMember: (token: string, workspaceId: string, memberId: string) =>
    apiFetch<{ deleted: boolean }>(
      `/workspaces/${workspaceId}/members/${memberId}`,
      token,
      { method: 'DELETE' },
    ),

  listCollections: (token: string, workspaceId: string) =>
    apiFetch<CollectionDto[]>(`/workspaces/${workspaceId}/collections`, token),

  createCollection: (
    token: string,
    workspaceId: string,
    name: string,
    parentId?: string,
  ) =>
    apiFetch<CollectionDto>(`/workspaces/${workspaceId}/collections`, token, {
      method: 'POST',
      body: JSON.stringify({ name, parentId }),
    }),

  deleteCollection: (token: string, id: string) =>
    apiFetch<{ deleted: boolean }>(`/collections/${id}`, token, {
      method: 'DELETE',
    }),

  createRequest: (
    token: string,
    collectionId: string,
    payload: Partial<ApiRequestDto>,
  ) =>
    apiFetch<ApiRequestDto>(`/collections/${collectionId}/requests`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateRequest: (
    token: string,
    id: string,
    payload: Partial<ApiRequestDto>,
  ) =>
    apiFetch<ApiRequestDto>(`/requests/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteRequest: (token: string, id: string) =>
    apiFetch<{ deleted: boolean }>(`/requests/${id}`, token, {
      method: 'DELETE',
    }),

  listEnvironments: (token: string, workspaceId: string) =>
    apiFetch<EnvironmentDto[]>(`/workspaces/${workspaceId}/environments`, token),

  createEnvironment: (
    token: string,
    workspaceId: string,
    name: string,
    variables: EnvVariable[] = [],
  ) =>
    apiFetch<EnvironmentDto>(`/workspaces/${workspaceId}/environments`, token, {
      method: 'POST',
      body: JSON.stringify({ name, variables }),
    }),

  updateEnvironment: (
    token: string,
    id: string,
    payload: { name?: string; variables?: EnvVariable[] },
  ) =>
    apiFetch<EnvironmentDto>(`/environments/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteEnvironment: (token: string, id: string) =>
    apiFetch<{ deleted: boolean }>(`/environments/${id}`, token, {
      method: 'DELETE',
    }),
};
