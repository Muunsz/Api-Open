import type { HttpMethod } from '@api-open/shared';
import type { ApiRequestDto } from './workspace';

export type ClientProtocol = 'http' | 'graphql' | 'ws' | 'sse';
export type AuthModalMode = 'login' | 'register' | 'magic';
export type NotificationTab = 'all' | 'error' | 'activity';
export type OverviewSubTab = 'docs' | 'updates' | 'analytics' | 'settings';
export type ResponseViewMode = 'pretty' | 'raw' | 'preview' | 'tree';

export interface ShortcutItem {
  keys: string;
  desc: string;
}

export interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

export interface SearchableRequestItem {
  kind: 'saved' | 'history';
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  rawReq?: ApiRequestDto;
}

export interface UrlEnvChip {
  key: string;
  value: string;
  found: boolean;
}

export interface ResponseHeaderItem {
  key: string;
  value: string;
}

export interface ResponseCookieItem {
  name: string;
  value: string;
  attributes: string;
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
