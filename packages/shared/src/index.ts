export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

export interface KeyValueItem {
  id: string;
  key: string;
  value: string;
  description?: string;
  enabled: boolean;
}

export type AuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apikey'; key: string; value: string; addTo: 'header' | 'query' };

export type BodyMode =
  | 'none'
  | 'raw'
  | 'urlencoded'
  | 'form-data'
  | 'binary'
  | 'graphql';

export interface BodyConfig {
  mode: BodyMode;
  raw?: string;
  rawType?: 'json' | 'xml' | 'html' | 'text';
  urlencoded?: KeyValueItem[];
  graphql?: {
    query: string;
    variables?: string;
  };
}

export interface ProxyExecuteRequest {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: BodyConfig;
  timeoutMs?: number;
}

export interface ProxyExecuteResponse {
  statusCode: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  headers: Record<string, string>;
  body: string;
  isBase64?: boolean;
}

export interface EnvVariable {
  id: string;
  key: string;
  value: string;
  isSecret: boolean;
  enabled: boolean;
}
