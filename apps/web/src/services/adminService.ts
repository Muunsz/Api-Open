const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api';

const ADMIN_TOKEN_KEY = 'api_open_admin_token_v1';

export function getStoredAdminToken(): string {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredAdminToken(token: string) {
  try {
    if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // ignore storage errors
  }
}

async function adminFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getStoredAdminToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const parsed = JSON.parse(text) as { message?: string | string[] };
      if (Array.isArray(parsed.message)) message = parsed.message.join(', ');
      else if (parsed.message) message = parsed.message;
    } catch {
      // keep raw text
    }
    throw new Error(message || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface AdminOverviewDto {
  counts: {
    users: number;
    workspaces: number;
    personalWorkspaces: number;
    teamWorkspaces: number;
    workspaceMembers: number;
    collections: number;
    collectionSnapshots: number;
    apiRequests: number;
    environments: number;
    requestHistories: number;
    activityLogs: number;
    emailLogs: number;
    emailLogsSent: number;
    emailLogsFailed: number;
    requestComments: number;
    monitors: number;
    monitorsEnabled: number;
    monitorsDisabled: number;
  };
  traffic24h: {
    requests: number;
    failedRequests: number;
    avgDurationMs: number;
    emails: number;
  };
  requestsByMethod: Array<{ method: string; count: number }>;
  system: {
    dbStatus: string;
    dbLatencyMs: number;
    nodeVersion: string;
    platform: string;
    environment?: string;
    runtimeHost?: string;
    sslStatus?: string;
    storageActive?: boolean;
    uptimeSeconds: number;
    memoryMb: { rss: number; heapUsed: number; heapTotal: number };
    integrations: {
      supabaseUrl: boolean;
      supabaseServiceRole: boolean;
      smtpConfigured: boolean;
      adminPasswordConfigured: boolean;
      adminCustomSecret: boolean;
    };
  };
  recentHistories: Array<{
    id: string;
    method: string;
    url: string;
    statusCode: number | null;
    durationMs: number | null;
    createdAt: string;
    user?: { email: string; name?: string | null };
    workspace?: { name: string };
  }>;
  recentActivities: Array<{
    id: string;
    type: string;
    method?: string | null;
    url?: string | null;
    statusCode?: number | null;
    durationMs?: number | null;
    message: string;
    createdAt: string;
    user?: { email: string };
    workspace?: { name: string } | null;
  }>;
  recentEmails: Array<{
    id: string;
    to: string;
    subject: string;
    category: string;
    status: string;
    error?: string | null;
    createdAt: string;
  }>;
}

export const adminService = {
  login: async (identifier: string, password: string) => {
    const data = await adminFetch<{
      token: string;
      admin: { email: string; role: string; expiresAt: string };
    }>('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: identifier, password }),
    });
    setStoredAdminToken(data.token);
    return data;
  },

  logout: () => {
    setStoredAdminToken('');
  },

  me: () =>
    adminFetch<{
      ok: boolean;
      admin: { sub: string; role: string; exp: number };
    }>('/admin/me'),

  getOverview: () => adminFetch<AdminOverviewDto>('/admin/overview'),

  listUsers: (q = '') =>
    adminFetch<
      Array<{
        id: string;
        email: string;
        name?: string | null;
        createdAt: string;
        updatedAt: string;
        _count: {
          memberships: number;
          histories: number;
          activityLogs: number;
          comments: number;
        };
      }>
    >(`/admin/users?q=${encodeURIComponent(q)}`),

  deleteUser: (id: string) =>
    adminFetch<{ deleted: boolean; id: string }>(`/admin/users/${id}`, {
      method: 'DELETE',
    }),

  listWorkspaces: (q = '', type = '') =>
    adminFetch<
      Array<{
        id: string;
        name: string;
        type: string;
        createdAt: string;
        updatedAt: string;
        members: Array<{
          role: string;
          user: { email: string; name?: string | null };
        }>;
        _count: {
          collections: number;
          environments: number;
          histories: number;
          monitors: number;
        };
      }>
    >(
      `/admin/workspaces?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}`,
    ),

  deleteWorkspace: (id: string) =>
    adminFetch<{ deleted: boolean; id: string }>(`/admin/workspaces/${id}`, {
      method: 'DELETE',
    }),

  listCollections: (q = '') =>
    adminFetch<
      Array<{
        id: string;
        name: string;
        updatedAt: string;
        workspace?: { id: string; name: string };
        parent?: { id: string; name: string } | null;
        _count: { requests: number; children: number; snapshots: number };
      }>
    >(`/admin/collections?q=${encodeURIComponent(q)}`),

  listRequests: (q = '', method = '') =>
    adminFetch<
      Array<{
        id: string;
        name: string;
        method: string;
        url: string;
        updatedAt: string;
        collection?: {
          id: string;
          name: string;
          workspace?: { id: string; name: string };
        };
        _count: { comments: number };
      }>
    >(
      `/admin/requests?q=${encodeURIComponent(q)}&method=${encodeURIComponent(method)}`,
    ),

  listHistories: (q = '', method = '', statusGroup = '') =>
    adminFetch<
      Array<{
        id: string;
        method: string;
        url: string;
        statusCode: number | null;
        durationMs: number | null;
        requestSnapshot: unknown;
        createdAt: string;
        user?: { email: string; name?: string | null };
        workspace?: { name: string };
      }>
    >(
      `/admin/histories?q=${encodeURIComponent(q)}&method=${encodeURIComponent(method)}&statusGroup=${encodeURIComponent(statusGroup)}`,
    ),

  listActivities: (q = '', type = '') =>
    adminFetch<
      Array<{
        id: string;
        type: string;
        method?: string | null;
        url?: string | null;
        statusCode?: number | null;
        durationMs?: number | null;
        message: string;
        createdAt: string;
        user?: { email: string; name?: string | null };
        workspace?: { name: string } | null;
      }>
    >(
      `/admin/activities?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}`,
    ),

  listEmails: (q = '', category = '', status = '') =>
    adminFetch<
      Array<{
        id: string;
        to: string;
        subject: string;
        category: string;
        status: string;
        error?: string | null;
        createdAt: string;
      }>
    >(
      `/admin/emails?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}&status=${encodeURIComponent(status)}`,
    ),

  listMonitors: (q = '') =>
    adminFetch<
      Array<{
        id: string;
        name: string;
        intervalMinutes: number;
        enabled: boolean;
        lastRunAt?: string | null;
        lastStatus?: string | null;
        lastPassed: number;
        lastFailed: number;
        workspace?: { id: string; name: string };
      }>
    >(`/admin/monitors?q=${encodeURIComponent(q)}`),

  toggleMonitor: (id: string) =>
    adminFetch<{ id: string; enabled: boolean }>(`/admin/monitors/${id}/toggle`, {
      method: 'PATCH',
    }),

  listEnvironments: (q = '') =>
    adminFetch<
      Array<{
        id: string;
        name: string;
        isGlobal: boolean;
        variables: Array<{ key?: string; value?: string; isSecret?: boolean; enabled?: boolean }>;
        updatedAt: string;
        workspace?: { id: string; name: string };
      }>
    >(`/admin/environments?q=${encodeURIComponent(q)}`),

  listComments: (q = '') =>
    adminFetch<
      Array<{
        id: string;
        content: string;
        createdAt: string;
        user?: { email: string; name?: string | null };
        request?: { id: string; name: string; method: string; url: string };
      }>
    >(`/admin/comments?q=${encodeURIComponent(q)}`),

  deleteComment: (id: string) =>
    adminFetch<{ deleted: boolean; id: string }>(`/admin/comments/${id}`, {
      method: 'DELETE',
    }),

  listSnapshots: (q = '') =>
    adminFetch<
      Array<{
        id: string;
        version: string;
        note?: string | null;
        createdAt: string;
        collection?: {
          id: string;
          name: string;
          workspace?: { id: string; name: string };
        };
      }>
    >(`/admin/snapshots?q=${encodeURIComponent(q)}`),

  verifyUserEmail: (id: string) =>
    adminFetch<{ verified: boolean; userId: string }>(
      `/admin/users/${id}/verify-email`,
      { method: 'POST' },
    ),

  sendUserPasswordReset: (id: string) =>
    adminFetch<{ ok: boolean; email: string }>(
      `/admin/users/${id}/reset-password`,
      { method: 'POST' },
    ),

  toggleWorkspaceType: (id: string) =>
    adminFetch<{ id: string; type: string }>(
      `/admin/workspaces/${id}/toggle-type`,
      { method: 'PATCH' },
    ),

  deleteCollection: (id: string) =>
    adminFetch<{ deleted: boolean; id: string }>(`/admin/collections/${id}`, {
      method: 'DELETE',
    }),

  deleteRequest: (id: string) =>
    adminFetch<{ deleted: boolean; id: string }>(`/admin/requests/${id}`, {
      method: 'DELETE',
    }),

  purgeHistories: (days = 30) =>
    adminFetch<{ deletedCount: number }>(`/admin/histories/purge?days=${days}`, {
      method: 'DELETE',
    }),

  purgeActivities: (days = 30) =>
    adminFetch<{ deletedCount: number }>(`/admin/activities/purge?days=${days}`, {
      method: 'DELETE',
    }),

  purgeEmails: (days = 30) =>
    adminFetch<{ deletedCount: number }>(`/admin/emails/purge?days=${days}`, {
      method: 'DELETE',
    }),

  sendTestEmail: (to: string) =>
    adminFetch<{ ok: boolean; to: string }>('/admin/emails/test', {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),

  deleteMonitor: (id: string) =>
    adminFetch<{ deleted: boolean; id: string }>(`/admin/monitors/${id}`, {
      method: 'DELETE',
    }),

  deleteEnvironment: (id: string) =>
    adminFetch<{ deleted: boolean; id: string }>(`/admin/environments/${id}`, {
      method: 'DELETE',
    }),

  deleteSnapshot: (id: string) =>
    adminFetch<{ deleted: boolean; id: string }>(`/admin/snapshots/${id}`, {
      method: 'DELETE',
    }),
};
