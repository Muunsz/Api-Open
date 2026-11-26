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
  | { type: 'inherit' }
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
    }
  | {
      type: 'oauth1';
      consumerKey: string;
      consumerSecret: string;
      token?: string;
      tokenSecret?: string;
      signatureMethod?: 'HMAC-SHA1' | 'HMAC-SHA256' | 'PLAINTEXT';
      realm?: string;
    }
  | {
      type: 'ntlm';
      username: string;
      password: string;
      domain?: string;
      workstation?: string;
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

export interface RequestSettings {
  followRedirects?: boolean;
  maxRedirects?: number;
  verifySsl?: boolean;
  timeoutMs?: number;
  encodeUrl?: boolean;
}

export interface ClientCertConfig {
  host: string;
  certPem: string;
  keyPem?: string;
  caPem?: string;
  passphrase?: string;
}

export interface ResponseTiming {
  dnsMs: number;
  tcpMs: number;
  tlsMs: number;
  ttfbMs: number;
  downloadMs: number;
  totalMs: number;
  remoteIp?: string;
  tlsProtocol?: string;
}

export interface TunnelProxyConfig {
  url: string;
  username?: string;
  password?: string;
}

export interface ProxyExecuteRequest {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  auth?: AuthConfig;
  body?: BodyConfig;
  timeoutMs?: number;
  followRedirects?: boolean;
  maxRedirects?: number;
  verifySsl?: boolean;
  clientCert?: ClientCertConfig;
  tunnelProxy?: TunnelProxyConfig;
}

export interface ProxyExecuteResponse {
  statusCode: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  headers: Record<string, string>;
  body: string;
  isBase64?: boolean;
  timing?: ResponseTiming;
  redirectedUrl?: string;
}

export interface EnvVariable {
  id: string;
  key: string;
  value: string;
  isSecret: boolean;
  enabled: boolean;
}

export interface ResponseExample {
  id: string;
  name: string;
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  createdAt?: string;
}
