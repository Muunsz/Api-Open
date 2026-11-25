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
  | { type: 'apikey'; key: string; value: string; addTo: 'header' | 'query' }
  | {
      type: 'oauth2';
      accessToken: string;
      tokenUrl?: string;
      clientId?: string;
      clientSecret?: string;
      scope?: string;
      headerPrefix?: string;
    }
  | {
      type: 'digest';
      username: string;
      password: string;
    }
  | {
      type: 'aws';
      accessKey: string;
      secretKey: string;
      region: string;
      service: string;
      sessionToken?: string;
    }
  | {
      type: 'hawk';
      hawkId: string;
      hawkKey: string;
      algorithm: 'sha256' | 'sha1';
    }
  | {
      type: 'jwt';
      secret: string;
      algorithm: 'HS256' | 'HS512';
      payload: string;
      headerPrefix?: string;
    };

export type BodyMode =
  | 'none'
  | 'raw'
  | 'urlencoded'
  | 'form-data'
  | 'binary'
  | 'graphql';

export interface FormDataItem {
  id: string;
  key: string;
  type: 'text' | 'file';
  value: string;
  fileName?: string;
  fileContentBase64?: string;
  mimeType?: string;
  enabled: boolean;
}

export interface BodyConfig {
  mode: BodyMode;
  raw?: string;
  rawType?: 'json' | 'xml' | 'html' | 'text';
  urlencoded?: KeyValueItem[];
  formData?: FormDataItem[];
  binary?: {
    fileName: string;
    contentBase64: string;
    mimeType?: string;
  };
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
  auth?: AuthConfig;
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
