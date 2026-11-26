import type {
  AuthConfig,
  BodyConfig,
  EnvVariable,
  HttpMethod,
  KeyValueItem,
  RequestSettings,
  ResponseExample,
} from '@api-open/shared';

export type WorkspaceType = 'PERSONAL' | 'TEAM';
export type WorkspaceRole = 'OWNER' | 'EDITOR' | 'VIEWER';
export type LogEntryType = 'http' | 'script' | 'error' | 'activity';

export interface WorkspaceDto {
  id: string;
  name: string;
  summary?: string | null;
  readme?: string | null;
  type: WorkspaceType;
  role: WorkspaceRole;
}

export interface WorkspaceMemberDto {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
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
  pathParams?: KeyValueItem[];
  auth: AuthConfig;
  body: BodyConfig;
  examples?: ResponseExample[];
  settings?: RequestSettings;
  order?: number;
  preRequestScript?: string | null;
  testScript?: string | null;
}

export interface CollectionDto {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  auth?: AuthConfig;
  headers?: KeyValueItem[];
  variables?: EnvVariable[];
  order?: number;
  requests: ApiRequestDto[];
}

export interface RequestCommentDto {
  id: string;
  requestId: string;
  userId: string;
  content: string;
  createdAt: string;
  user: {
    id: string;
    email: string;
    name?: string | null;
    avatarUrl?: string | null;
  };
}

export interface MonitorDto {
  id: string;
  workspaceId: string;
  collectionId: string;
  name: string;
  intervalMinutes: number;
  enabled: boolean;
  lastRunAt?: string | null;
  lastStatus?: string | null;
  lastPassed: number;
  lastFailed: number;
}

export interface HistoryRecordDto {
  id: string;
  workspaceId: string;
  method: HttpMethod;
  url: string;
  statusCode?: number | null;
  durationMs?: number | null;
  requestSnapshot?: Record<string, unknown>;
  createdAt: string;
}

export interface EnvironmentDto {
  id: string;
  workspaceId: string;
  name: string;
  isGlobal: boolean;
  variables: EnvVariable[];
}

export interface UserProfileDto {
  id: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface ActivityLogDto {
  id: string;
  type: LogEntryType;
  method?: string | null;
  url?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  message: string;
  createdAt: string;
}

export interface EmailLogDto {
  id: string;
  to: string;
  subject: string;
  category: string;
  status: 'sent' | 'failed';
  error?: string | null;
  createdAt: string;
}
