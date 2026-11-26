import type { AuthConfig, EnvVariable, KeyValueItem } from '@api-open/shared';
import type {
  ActivityLogDto,
  ApiRequestDto,
  CollectionDto,
  EmailLogDto,
  EnvironmentDto,
  HistoryRecordDto,
  LogEntryType,
  MonitorDto,
  RequestCommentDto,
  UserProfileDto,
  WorkspaceDto,
  WorkspaceMemberDto,
  WorkspaceRole,
} from '../types/workspace';
import { API_BASE, apiFetch } from './httpClient';

export const workspaceService = {
  getProfile: (token: string) =>
    apiFetch<UserProfileDto>('/workspaces/profile/me', token),

  updateProfile: (
    token: string,
    payload: { name?: string; avatarUrl?: string | null },
  ) =>
    apiFetch<UserProfileDto>('/workspaces/profile/me', token, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  listWorkspaces: (token: string) =>
    apiFetch<WorkspaceDto[]>('/workspaces', token),

  createWorkspace: (token: string, name: string) =>
    apiFetch<WorkspaceDto>('/workspaces', token, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  updateWorkspace: (
    token: string,
    workspaceId: string,
    payload: { name?: string; summary?: string; readme?: string },
  ) =>
    apiFetch<WorkspaceDto>(`/workspaces/${workspaceId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  listMembers: (token: string, workspaceId: string) =>
    apiFetch<WorkspaceMemberDto[]>(`/workspaces/${workspaceId}/members`, token),

  inviteMember: (
    token: string,
    workspaceId: string,
    email: string,
    role: WorkspaceRole,
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

  updateMemberRole: (
    token: string,
    workspaceId: string,
    memberId: string,
    role: WorkspaceRole,
  ) =>
    apiFetch<WorkspaceMemberDto>(
      `/workspaces/${workspaceId}/members/${memberId}`,
      token,
      { method: 'PATCH', body: JSON.stringify({ role }) },
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

  updateCollection: (
    token: string,
    id: string,
    payload: {
      name?: string;
      parentId?: string | null;
      order?: number;
      auth?: AuthConfig;
      headers?: KeyValueItem[];
      variables?: EnvVariable[];
    },
  ) =>
    apiFetch<CollectionDto>(`/collections/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  duplicateCollection: (token: string, id: string) =>
    apiFetch<CollectionDto>(`/collections/${id}/duplicate`, token, {
      method: 'POST',
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

  listLogs: (token: string, workspaceId?: string) =>
    apiFetch<ActivityLogDto[]>(
      workspaceId
        ? `/workspaces/logs?workspaceId=${encodeURIComponent(workspaceId)}`
        : '/workspaces/logs',
      token,
    ),

  createLog: (
    token: string,
    payload: {
      type: LogEntryType;
      method?: string;
      url?: string;
      statusCode?: number;
      durationMs?: number;
      message: string;
      workspaceId?: string;
    },
  ) =>
    apiFetch<{ id: string; createdAt: string }>('/workspaces/logs', token, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  clearLogs: (token: string, workspaceId?: string) =>
    apiFetch<{ cleared: boolean }>(
      workspaceId
        ? `/workspaces/logs?workspaceId=${encodeURIComponent(workspaceId)}`
        : '/workspaces/logs',
      token,
      { method: 'DELETE' },
    ),

  listEmailLogs: (token: string) =>
    apiFetch<EmailLogDto[]>('/workspaces/email-logs', token),

  listHistory: (token: string, workspaceId: string, limit = 100) =>
    apiFetch<HistoryRecordDto[]>(
      `/workspaces/${workspaceId}/history?limit=${limit}`,
      token,
    ),

  createHistory: (
    token: string,
    workspaceId: string,
    payload: {
      method: string;
      url: string;
      statusCode?: number;
      durationMs?: number;
      requestSnapshot?: Record<string, unknown>;
    },
  ) =>
    apiFetch<HistoryRecordDto>(`/workspaces/${workspaceId}/history`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  clearHistory: (token: string, workspaceId: string) =>
    apiFetch<{ cleared: boolean }>(
      `/workspaces/${workspaceId}/history`,
      token,
      { method: 'DELETE' },
    ),

  listComments: (token: string, requestId: string) =>
    apiFetch<RequestCommentDto[]>(`/requests/${requestId}/comments`, token),

  addComment: (token: string, requestId: string, content: string) =>
    apiFetch<RequestCommentDto>(`/requests/${requestId}/comments`, token, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  deleteComment: (token: string, commentId: string) =>
    apiFetch<{ deleted: boolean }>(`/comments/${commentId}`, token, {
      method: 'DELETE',
    }),

  listMonitors: (token: string, workspaceId: string) =>
    apiFetch<MonitorDto[]>(`/workspaces/${workspaceId}/monitors`, token),

  createMonitor: (
    token: string,
    workspaceId: string,
    payload: { collectionId: string; name: string; intervalMinutes?: number },
  ) =>
    apiFetch<MonitorDto>(`/workspaces/${workspaceId}/monitors`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateMonitor: (
    token: string,
    id: string,
    payload: { name?: string; intervalMinutes?: number; enabled?: boolean },
  ) =>
    apiFetch<MonitorDto>(`/monitors/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  runMonitor: (token: string, id: string) =>
    apiFetch<MonitorDto>(`/monitors/${id}/run`, token, { method: 'POST' }),

  deleteMonitor: (token: string, id: string) =>
    apiFetch<{ deleted: boolean }>(`/monitors/${id}`, token, {
      method: 'DELETE',
    }),

  listSnapshots: (token: string, collectionId: string) =>
    apiFetch<Array<{ id: string; collectionId: string; version: string; note?: string | null; createdAt: string }>>(
      `/collections/${collectionId}/snapshots`,
      token,
    ),

  createSnapshot: (
    token: string,
    collectionId: string,
    payload: { version: string; note?: string },
  ) =>
    apiFetch<{ id: string; version: string; createdAt: string }>(
      `/collections/${collectionId}/snapshots`,
      token,
      { method: 'POST', body: JSON.stringify(payload) },
    ),

  restoreSnapshot: (token: string, snapshotId: string) =>
    apiFetch<{ restored: boolean; collectionId: string }>(
      `/snapshots/${snapshotId}/restore`,
      token,
      { method: 'POST' },
    ),

  getPublicDocs: (collectionId: string) =>
    fetch(`${API_BASE}/public/docs/${collectionId}`).then((r) => {
      if (!r.ok) throw new Error('Public documentation not found');
      return r.json() as Promise<{
        id: string;
        name: string;
        requests: ApiRequestDto[];
        folders: Array<{ id: string; name: string; requests: ApiRequestDto[] }>;
      }>;
    }),

  logAuthEmail: (payload: {
    to: string;
    subject: string;
    category: 'auth_verification' | 'auth_magic_link' | 'auth_password_reset';
    status?: 'sent' | 'failed';
    error?: string;
  }) =>
    fetch(`${API_BASE}/mail/auth-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => undefined),
};
