<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AuthConfig, FormDataItem } from '@api-open/shared';
import { Delete, Plus } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { unwrapStringifiedBody } from '../utils/bodyFormat';
import { workspaceApi, type RequestCommentDto } from '../api/workspace';
import { fileToBase64 } from '../services/exportService';
import {
  exchangeOAuth2ClientCredentials,
  executeProxyRequest,
  introspectGraphqlEndpoint,
} from '../services/proxyService';
import { useSettingsStore } from '../stores/settings';
import { useTabsStore } from '../stores/tabs';
import { useWorkspaceStore } from '../stores/workspace';
import { aiGenerateTests } from '../utils/aiAssistant';
import type { GqlFieldSummary } from '../utils/graphqlIntrospection';
import CodeEditor from './CodeEditor.vue';
import KeyValueTable from './KeyValueTable.vue';

const props = defineProps<{
  activeTabName: string;
  effectiveVariablesMap: Record<string, string>;
}>();

const emit = defineEmits<{
  (e: 'update:activeTabName', val: string): void;
  (
    e: 'open-gql-schema',
    payload: { queries: GqlFieldSummary[]; mutations: GqlFieldSummary[] },
  ): void;
}>();

const store = useTabsStore();
const ws = useWorkspaceStore();

const tab = computed(() => store.activeTab);
const gqlLoading = ref(false);
const fetchingOAuthToken = ref(false);
const oauthAuthUrl = ref('');
const comments = ref<RequestCommentDto[]>([]);
const newCommentText = ref('');
const loadingComments = ref(false);

watch(
  () => tab.value?.savedRequestId,
  async (reqId) => {
    if (!reqId || !ws.accessToken) {
      comments.value = [];
      return;
    }
    loadingComments.value = true;
    try {
      comments.value = await workspaceApi.listComments(ws.accessToken, reqId);
    } catch {
      comments.value = [];
    } finally {
      loadingComments.value = false;
    }
  },
  { immediate: true },
);

async function submitComment() {
  if (!tab.value?.savedRequestId || !ws.accessToken || !newCommentText.value.trim()) {
    return;
  }
  const created = await workspaceApi.addComment(
    ws.accessToken,
    tab.value.savedRequestId,
    newCommentText.value,
  );
  comments.value = [created, ...comments.value];
  newCommentText.value = '';
}

async function removeComment(commentId: string) {
  if (!ws.accessToken) return;
  await workspaceApi.deleteComment(ws.accessToken, commentId);
  comments.value = comments.value.filter((c) => c.id !== commentId);
}

async function startOAuth2PkceFlow() {
  if (!tab.value || tab.value.auth.type !== 'oauth2') return;
  const auth = tab.value.auth;
  if (!oauthAuthUrl.value.trim() || !auth.tokenUrl?.trim() || !auth.clientId?.trim()) {
    ElMessage.warning('Fill Auth URL, Token URL, and Client ID for PKCE');
    return;
  }
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const base64Url = (buf: Uint8Array) =>
    btoa(String.fromCharCode(...buf))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const codeVerifier = base64Url(verifierBytes);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(codeVerifier),
  );
  const codeChallenge = base64Url(new Uint8Array(digest));
  const redirectUri = window.location.origin;

  const url = new URL(oauthAuthUrl.value.trim());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', auth.clientId.trim());
  url.searchParams.set('redirect_uri', redirectUri);
  if (auth.scope) url.searchParams.set('scope', auth.scope);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  const popup = window.open(url.toString(), 'oauth2_pkce', 'width=520,height=640');
  if (!popup) {
    ElMessage.error('Popup blocked. Allow popups to complete OAuth2 PKCE.');
    return;
  }

  const timer = setInterval(async () => {
    try {
      if (popup.closed) {
        clearInterval(timer);
        return;
      }
      if (popup.location.origin === window.location.origin) {
        const code = new URL(popup.location.href).searchParams.get('code');
        popup.close();
        clearInterval(timer);
        if (code) {
          fetchingOAuthToken.value = true;
          try {
            const tokenRes = await executeProxyRequest({
              method: 'POST',
              url: auth.tokenUrl!,
              body: {
                mode: 'urlencoded',
                urlencoded: [
                  { id: '1', key: 'grant_type', value: 'authorization_code', enabled: true },
                  { id: '2', key: 'code', value: code, enabled: true },
                  { id: '3', key: 'redirect_uri', value: redirectUri, enabled: true },
                  { id: '4', key: 'client_id', value: auth.clientId || '', enabled: true },
                  { id: '5', key: 'code_verifier', value: codeVerifier, enabled: true },
                ],
              },
            });
            const parsed = JSON.parse(tokenRes.body) as { access_token?: string };
            if (parsed.access_token) {
              auth.accessToken = parsed.access_token;
              ElMessage.success('OAuth2 PKCE token received');
            }
          } finally {
            fetchingOAuthToken.value = false;
          }
        }
      }
    } catch {
      // Cross-origin while user is on auth provider page
    }
  }, 400);
}

const inheritedAuthInfo = computed(() =>
  ws.getEffectiveCollectionAuthAndHeaders(tab.value?.collectionId),
);

const oauth2Auth = computed({
  get: (): Extract<AuthConfig, { type: 'oauth2' }> =>
    tab.value?.auth.type === 'oauth2'
      ? tab.value.auth
      : {
          type: 'oauth2',
          accessToken: '',
          headerPrefix: 'Bearer',
          tokenUrl: '',
          clientId: '',
          clientSecret: '',
          scope: '',
        },
  set: (val) => {
    if (tab.value) tab.value.auth = val;
  },
});

function formatJsonBody() {
  if (!tab.value?.body.raw) return;
  const unwrapped = unwrapStringifiedBody(tab.value.body.raw);
  tab.value.body.raw = unwrapped;
  try {
    const parsed = JSON.parse(unwrapped);
    if (parsed !== null && typeof parsed === 'object') {
      tab.value.body.raw = JSON.stringify(parsed, null, 2);
    }
  } catch {
    // keep unwrapped text (e.g. JSON with comments)
  }
}

function addFormDataRow() {
  if (!tab.value) return;
  if (!tab.value.body.formData) tab.value.body.formData = [];
  tab.value.body.formData.push({
    id: Math.random().toString(36).slice(2, 10),
    key: '',
    type: 'text',
    value: '',
    enabled: true,
  });
}

async function handleFormDataFileChange(row: FormDataItem, e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  row.fileName = file.name;
  row.mimeType = file.type || 'application/octet-stream';
  row.fileContentBase64 = await fileToBase64(file);
}

async function handleBinaryFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file || !tab.value) return;
  tab.value.body.binary = {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    contentBase64: await fileToBase64(file),
  };
}

async function fetchGraphqlSchema() {
  if (!tab.value?.url.trim()) return;
  gqlLoading.value = true;
  try {
    const parsed = await introspectGraphqlEndpoint(
      tab.value.url,
      ws.activeVariablesMap,
    );
    emit('open-gql-schema', parsed);
  } catch (err) {
    ElMessage.error(
      err instanceof Error ? err.message : 'Introspection failed',
    );
  } finally {
    gqlLoading.value = false;
  }
}

async function fetchOAuth2Token() {
  if (!tab.value || tab.value.auth.type !== 'oauth2') return;
  const auth = tab.value.auth;
  if (!auth.tokenUrl?.trim()) {
    ElMessage.warning('Enter Token URL first');
    return;
  }
  fetchingOAuthToken.value = true;
  try {
    auth.accessToken = await exchangeOAuth2ClientCredentials(
      auth,
      props.effectiveVariablesMap,
    );
    ElMessage.success('Access token fetched');
  } catch (err) {
    ElMessage.error(
      err instanceof Error ? err.message : 'Failed to fetch OAuth token',
    );
  } finally {
    fetchingOAuthToken.value = false;
  }
}

function insertTestTemplate(kind: 'status' | 'json' | 'env') {
  if (!tab.value) return;
  const snippets: Record<string, string> = {
    status: `pm.test("Status code is 200", () => {\n  pm.expect(pm.response.code).to.equal(200);\n});\n`,
    json: `pm.test("Response has expected field", () => {\n  const data = pm.response.json();\n  pm.expect(data).to.have.property("id");\n});\n`,
    env: `const data = pm.response.json();\npm.environment.set("token", data.token);\nconsole.log("Saved token");\n`,
  };
  tab.value.testScript =
    (tab.value.testScript ? tab.value.testScript + '\n' : '') + snippets[kind];
}

const aiGeneratingTests = ref(false);
const settingsStore = useSettingsStore();

async function handleAiGenerateTests() {
  if (!tab.value) return;
  aiGeneratingTests.value = true;
  try {
    const status = tab.value.response?.statusCode ?? 200;
    const body = tab.value.response?.body ?? '{}';
    const generated = await aiGenerateTests(status, body, settingsStore.aiConfig);
    tab.value.testScript =
      (tab.value.testScript ? tab.value.testScript.trimEnd() + '\n\n' : '') + generated;
    ElMessage.success('Generated test assertions');
  } finally {
    aiGeneratingTests.value = false;
  }
}
</script>

<template>
  <div v-if="tab" class="request-pane">
    <el-tabs
      :model-value="activeTabName"
      class="request-tabs"
      @update:model-value="emit('update:activeTabName', String($event))"
    >
      <el-tab-pane label="Params" name="params">
        <div v-if="tab.pathParams?.length" style="margin-bottom: 14px">
          <div style="font-size: 12px; font-weight: 600; color: var(--ao-text-muted); margin-bottom: 6px">
            Path Variables (auto-detected from :param or {param})
          </div>
          <el-table :data="tab.pathParams" size="small" border>
            <el-table-column width="46" align="center">
              <template #default="{ row }">
                <el-checkbox v-model="row.enabled" />
              </template>
            </el-table-column>
            <el-table-column label="Path Key" width="180">
              <template #default="{ row }">
                <code>:{{ row.key }}</code>
              </template>
            </el-table-column>
            <el-table-column label="Value">
              <template #default="{ row }">
                <el-input
                  v-model="row.value"
                  size="small"
                  placeholder="Value (supports {{variable}})"
                />
              </template>
            </el-table-column>
            <el-table-column label="Description">
              <template #default="{ row }">
                <el-input
                  v-model="row.description"
                  size="small"
                  placeholder="Description"
                />
              </template>
            </el-table-column>
          </el-table>
        </div>

        <KeyValueTable
          :rows="tab.queryParams"
          key-placeholder="Query param"
          value-placeholder="Value"
        />
      </el-tab-pane>

      <el-tab-pane label="Authorization" name="auth">
        <el-form label-width="110px" size="small" style="max-width: 520px">
          <el-form-item label="Auth Type">
            <el-select
              :model-value="tab.auth.type"
              @update:model-value="
                (val: string) => {
                  if (val === 'none') tab.auth = { type: 'none' };
                  else if (val === 'inherit') tab.auth = { type: 'inherit' };
                  else if (val === 'bearer')
                    tab.auth = { type: 'bearer', token: '' };
                  else if (val === 'basic')
                    tab.auth = {
                      type: 'basic',
                      username: '',
                      password: '',
                    };
                  else if (val === 'digest')
                    tab.auth = {
                      type: 'digest',
                      username: '',
                      password: '',
                    };
                  else if (val === 'oauth2')
                    tab.auth = {
                      type: 'oauth2',
                      accessToken: '',
                      tokenUrl: '',
                      clientId: '',
                      clientSecret: '',
                      scope: '',
                      headerPrefix: 'Bearer',
                    };
                  else if (val === 'apikey')
                    tab.auth = {
                      type: 'apikey',
                      key: '',
                      value: '',
                      addTo: 'header',
                    };
                  else if (val === 'aws')
                    tab.auth = {
                      type: 'aws',
                      accessKey: '',
                      secretKey: '',
                      region: 'us-east-1',
                      service: 'execute-api',
                      sessionToken: '',
                    };
                  else if (val === 'hawk')
                    tab.auth = {
                      type: 'hawk',
                      hawkId: '',
                      hawkKey: '',
                      algorithm: 'sha256',
                    };
                  else if (val === 'jwt')
                    tab.auth = {
                      type: 'jwt',
                      secret: '',
                      algorithm: 'HS256',
                      payload: '{\n  &quot;sub&quot;: &quot;1234567890&quot;\n}',
                      headerPrefix: 'Bearer',
                    };
                  else if (val === 'oauth1')
                    tab.auth = {
                      type: 'oauth1',
                      consumerKey: '',
                      consumerSecret: '',
                      token: '',
                      tokenSecret: '',
                      signatureMethod: 'HMAC-SHA1',
                      realm: '',
                    };
                  else if (val === 'ntlm')
                    tab.auth = {
                      type: 'ntlm',
                      username: '',
                      password: '',
                      domain: '',
                      workstation: '',
                    };
                }
              "
            >
              <el-option label="No Auth" value="none" />
              <el-option label="Inherit auth from parent" value="inherit" />
              <el-option label="Bearer Token" value="bearer" />
              <el-option label="Basic Auth" value="basic" />
              <el-option label="Digest Auth" value="digest" />
              <el-option label="OAuth 1.0" value="oauth1" />
              <el-option label="OAuth 2.0" value="oauth2" />
              <el-option label="API Key" value="apikey" />
              <el-option label="AWS Signature" value="aws" />
              <el-option label="HAWK" value="hawk" />
              <el-option label="JWT" value="jwt" />
              <el-option label="NTLM Auth" value="ntlm" />
            </el-select>
          </el-form-item>

          <el-alert
            v-if="tab.auth.type === 'inherit'"
            type="info"
            :closable="false"
            show-icon
            style="margin-bottom: 12px"
            :title="
              inheritedAuthInfo.auth.type !== 'none'
                ? `Inheriting ${inheritedAuthInfo.auth.type.toUpperCase()} auth from collection: ${inheritedAuthInfo.sourceCollectionName}`
                : 'No parent collection auth configured (select a Collection -> Auth & Headers in sidebar to configure).'
            "
          />

          <template v-if="tab.auth.type === 'bearer'">
            <el-form-item label="Token">
              <el-input
                v-model="tab.auth.token"
                placeholder="Bearer token"
                show-password
              />
            </el-form-item>
          </template>

          <template
            v-if="tab.auth.type === 'basic' || tab.auth.type === 'digest'"
          >
            <el-form-item label="Username">
              <el-input v-model="tab.auth.username" />
            </el-form-item>
            <el-form-item label="Password">
              <el-input v-model="tab.auth.password" show-password />
            </el-form-item>
          </template>

          <template v-if="tab.auth.type === 'oauth2'">
            <el-form-item label="Access Token">
              <el-input
                v-model="oauth2Auth.accessToken"
                placeholder="Access token"
                show-password
              />
            </el-form-item>
            <el-form-item label="Header Prefix">
              <el-input
                v-model="oauth2Auth.headerPrefix"
                placeholder="Bearer"
              />
            </el-form-item>
            <el-form-item label="Token URL">
              <el-input
                v-model="oauth2Auth.tokenUrl"
                placeholder="https://auth.example.com/oauth/token"
              />
            </el-form-item>
            <el-form-item label="Client ID">
              <el-input v-model="oauth2Auth.clientId" />
            </el-form-item>
            <el-form-item label="Client Secret">
              <el-input v-model="oauth2Auth.clientSecret" show-password />
            </el-form-item>
            <el-form-item label="Scope">
              <el-input v-model="oauth2Auth.scope" placeholder="read write" />
            </el-form-item>
            <el-form-item label="Auth URL (PKCE)">
              <el-input
                v-model="oauthAuthUrl"
                placeholder="https://auth.example.com/oauth/authorize"
              />
            </el-form-item>
            <el-form-item>
              <div style="display: flex; gap: 8px; flex-wrap: wrap">
                <el-button
                  size="small"
                  type="primary"
                  :loading="fetchingOAuthToken"
                  @click="fetchOAuth2Token"
                >
                  Client Credentials Token
                </el-button>
                <el-button
                  size="small"
                  :loading="fetchingOAuthToken"
                  @click="startOAuth2PkceFlow"
                >
                  Auth Code + PKCE
                </el-button>
              </div>
            </el-form-item>
          </template>

          <template v-if="tab.auth.type === 'apikey'">
            <el-form-item label="Key">
              <el-input v-model="tab.auth.key" placeholder="X-API-Key" />
            </el-form-item>
            <el-form-item label="Value">
              <el-input v-model="tab.auth.value" />
            </el-form-item>
            <el-form-item label="Add to">
              <el-radio-group v-model="tab.auth.addTo">
                <el-radio value="header">Header</el-radio>
                <el-radio value="query">Query Params</el-radio>
              </el-radio-group>
            </el-form-item>
          </template>

          <template v-if="tab.auth.type === 'aws'">
            <el-form-item label="Access Key">
              <el-input v-model="tab.auth.accessKey" />
            </el-form-item>
            <el-form-item label="Secret Key">
              <el-input v-model="tab.auth.secretKey" show-password />
            </el-form-item>
            <el-form-item label="AWS Region">
              <el-input v-model="tab.auth.region" placeholder="us-east-1" />
            </el-form-item>
            <el-form-item label="Service Name">
              <el-input
                v-model="tab.auth.service"
                placeholder="execute-api"
              />
            </el-form-item>
            <el-form-item label="Session Token">
              <el-input
                v-model="tab.auth.sessionToken"
                placeholder="Optional"
                show-password
              />
            </el-form-item>
          </template>

          <template v-if="tab.auth.type === 'hawk'">
            <el-form-item label="Hawk Auth ID">
              <el-input v-model="tab.auth.hawkId" />
            </el-form-item>
            <el-form-item label="Hawk Auth Key">
              <el-input v-model="tab.auth.hawkKey" show-password />
            </el-form-item>
            <el-form-item label="Algorithm">
              <el-select v-model="tab.auth.algorithm">
                <el-option label="sha256" value="sha256" />
                <el-option label="sha1" value="sha1" />
              </el-select>
            </el-form-item>
          </template>

          <template v-if="tab.auth.type === 'jwt'">
            <el-form-item label="Algorithm">
              <el-select v-model="tab.auth.algorithm">
                <el-option label="HS256" value="HS256" />
                <el-option label="HS512" value="HS512" />
              </el-select>
            </el-form-item>
            <el-form-item label="Secret">
              <el-input v-model="tab.auth.secret" show-password />
            </el-form-item>
            <el-form-item label="Header Prefix">
              <el-input
                v-model="tab.auth.headerPrefix"
                placeholder="Bearer"
              />
            </el-form-item>
            <el-form-item label="Payload (JSON)">
              <el-input
                v-model="tab.auth.payload"
                type="textarea"
                :rows="4"
                class="code-area"
              />
            </el-form-item>
          </template>

          <template v-if="tab.auth.type === 'oauth1'">
            <el-form-item label="Consumer Key">
              <el-input v-model="tab.auth.consumerKey" />
            </el-form-item>
            <el-form-item label="Consumer Secret">
              <el-input v-model="tab.auth.consumerSecret" show-password />
            </el-form-item>
            <el-form-item label="Access Token">
              <el-input v-model="tab.auth.token" placeholder="Optional" />
            </el-form-item>
            <el-form-item label="Token Secret">
              <el-input
                v-model="tab.auth.tokenSecret"
                show-password
                placeholder="Optional"
              />
            </el-form-item>
            <el-form-item label="Signature Method">
              <el-select v-model="tab.auth.signatureMethod">
                <el-option label="HMAC-SHA1" value="HMAC-SHA1" />
                <el-option label="HMAC-SHA256" value="HMAC-SHA256" />
                <el-option label="PLAINTEXT" value="PLAINTEXT" />
              </el-select>
            </el-form-item>
            <el-form-item label="Realm">
              <el-input v-model="tab.auth.realm" placeholder="Optional" />
            </el-form-item>
          </template>

          <template v-if="tab.auth.type === 'ntlm'">
            <el-form-item label="Username">
              <el-input v-model="tab.auth.username" />
            </el-form-item>
            <el-form-item label="Password">
              <el-input v-model="tab.auth.password" show-password />
            </el-form-item>
            <el-form-item label="Domain">
              <el-input v-model="tab.auth.domain" placeholder="Optional (e.g. CORP)" />
            </el-form-item>
            <el-form-item label="Workstation">
              <el-input v-model="tab.auth.workstation" placeholder="Optional" />
            </el-form-item>
          </template>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="Headers" name="headers">
        <KeyValueTable
          :rows="tab.headers"
          key-placeholder="Header"
          value-placeholder="Value"
        />
      </el-tab-pane>

      <el-tab-pane label="Body" name="body">
        <div class="body-controls">
          <el-radio-group v-model="tab.body.mode" size="small">
            <el-radio-button value="none">none</el-radio-button>
            <el-radio-button value="form-data">form-data</el-radio-button>
            <el-radio-button value="urlencoded">
              x-www-form-urlencoded
            </el-radio-button>
            <el-radio-button value="raw">raw</el-radio-button>
            <el-radio-button value="binary">binary</el-radio-button>
            <el-radio-button value="graphql">GraphQL</el-radio-button>
          </el-radio-group>

          <template v-if="tab.body.mode === 'raw'">
            <el-select
              v-model="tab.body.rawType"
              size="small"
              style="width: 100px"
            >
              <el-option label="JSON" value="json" />
              <el-option label="Text" value="text" />
              <el-option label="XML" value="xml" />
              <el-option label="HTML" value="html" />
            </el-select>
            <el-button
              v-if="tab.body.rawType === 'json'"
              size="small"
              @click="formatJsonBody"
            >
              Beautify JSON
            </el-button>
          </template>

          <el-button
            v-if="tab.body.mode === 'graphql'"
            size="small"
            :loading="gqlLoading"
            @click="fetchGraphqlSchema"
          >
            Fetch Schema
          </el-button>
        </div>

        <CodeEditor
          v-if="tab.body.mode === 'raw'"
          :model-value="tab.body.raw ?? ''"
          :language="tab.body.rawType || 'json'"
          :rows="7"
          :variables="effectiveVariablesMap"
          placeholder="Request body (type {{ for variables)..."
          @update:model-value="tab.body.raw = $event"
        />

        <div v-else-if="tab.body.mode === 'form-data'">
          <el-table :data="tab.body.formData ?? []" size="small" border>
            <el-table-column width="46" align="center">
              <template #default="{ row }">
                <el-checkbox v-model="row.enabled" />
              </template>
            </el-table-column>
            <el-table-column label="Key" width="180">
              <template #default="{ row }">
                <el-input v-model="row.key" size="small" placeholder="field" />
              </template>
            </el-table-column>
            <el-table-column label="Type" width="100">
              <template #default="{ row }">
                <el-select v-model="row.type" size="small">
                  <el-option label="Text" value="text" />
                  <el-option label="File" value="file" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="Value">
              <template #default="{ row }">
                <el-input
                  v-if="row.type === 'text'"
                  v-model="row.value"
                  size="small"
                  placeholder="Value"
                />
                <div
                  v-else
                  style="display: flex; align-items: center; gap: 8px"
                >
                  <input
                    type="file"
                    @change="(e: Event) => handleFormDataFileChange(row, e)"
                  />
                  <el-text v-if="row.fileName" size="small" type="info">
                    {{ row.fileName }}
                  </el-text>
                </div>
              </template>
            </el-table-column>
            <el-table-column width="54" align="center">
              <template #default="{ $index }">
                <el-button
                  :icon="Delete"
                  link
                  type="danger"
                  @click="tab.body.formData?.splice($index, 1)"
                />
              </template>
            </el-table-column>
          </el-table>
          <el-button
            size="small"
            :icon="Plus"
            style="margin-top: 8px"
            @click="addFormDataRow"
          >
            Add Field
          </el-button>
        </div>

        <div v-else-if="tab.body.mode === 'binary'" class="binary-box">
          <input type="file" @change="handleBinaryFileChange" />
          <el-text
            v-if="tab.body.binary?.fileName"
            type="info"
            size="small"
          >
            Selected: {{ tab.body.binary.fileName }} ({{
              tab.body.binary.mimeType
            }})
          </el-text>
        </div>

        <KeyValueTable
          v-else-if="tab.body.mode === 'urlencoded' && tab.body.urlencoded"
          :rows="tab.body.urlencoded"
        />

        <div
          v-else-if="tab.body.mode === 'graphql' && tab.body.graphql"
          class="gql-grid"
        >
          <CodeEditor
            :model-value="tab.body.graphql.query"
            language="graphql"
            :rows="6"
            :variables="effectiveVariablesMap"
            placeholder="query { ... }"
            @update:model-value="tab.body.graphql.query = $event"
          />
          <CodeEditor
            :model-value="tab.body.graphql.variables ?? ''"
            language="json"
            :rows="6"
            :variables="effectiveVariablesMap"
            placeholder='{ "id": 1 }'
            @update:model-value="tab.body.graphql.variables = $event"
          />
        </div>
      </el-tab-pane>

      <el-tab-pane label="Pre-request" name="preRequest">
        <CodeEditor
          :model-value="tab.preRequestScript"
          language="javascript"
          :rows="5"
          :variables="effectiveVariablesMap"
          placeholder='// Runs before sending request&#10;// pm.environment.set("timestamp", Date.now());'
          @update:model-value="tab.preRequestScript = $event"
        />
        <div style="margin-top: 10px">
          <div style="font-size: 12px; font-weight: 600; color: var(--ao-text-muted); margin-bottom: 4px">
            Workspace Shared Script Library (auto-prepended to Pre-request &amp; Test scripts)
          </div>
          <CodeEditor
            :model-value="ws.sharedScript"
            language="javascript"
            :rows="3"
            :variables="effectiveVariablesMap"
            placeholder="// Shared helper functions (e.g. function signPayload(x) { ... })"
            @update:model-value="ws.sharedScript = $event"
          />
        </div>
      </el-tab-pane>

      <el-tab-pane label="Tests" name="tests">
        <div class="body-controls">
          <el-text size="small" type="info">Snippets:</el-text>
          <el-button size="small" @click="insertTestTemplate('status')">
            Status 200
          </el-button>
          <el-button size="small" @click="insertTestTemplate('json')">
            Has Property
          </el-button>
          <el-button size="small" @click="insertTestTemplate('env')">
            Set Env Var
          </el-button>
          <el-button
            size="small"
            type="primary"
            plain
            :loading="aiGeneratingTests"
            @click="handleAiGenerateTests"
          >
            AI Generate Tests
          </el-button>
        </div>
        <CodeEditor
          :model-value="tab.testScript"
          language="javascript"
          :rows="6"
          :variables="effectiveVariablesMap"
          placeholder='pm.test("Status is 200", () => {&#10;  pm.expect(pm.response.code).to.equal(200);&#10;});'
          @update:model-value="tab.testScript = $event"
        />
      </el-tab-pane>

      <el-tab-pane label="Settings" name="settings">
        <el-form label-width="190px" size="small" style="max-width: 520px">
          <el-form-item label="Follow Redirects">
            <el-switch v-model="tab.settings.followRedirects" />
          </el-form-item>
          <el-form-item label="Max Redirects">
            <el-input-number
              v-model="tab.settings.maxRedirects"
              :min="0"
              :max="20"
            />
          </el-form-item>
          <el-form-item label="Verify SSL Certificate">
            <el-switch v-model="tab.settings.verifySsl" />
          </el-form-item>
          <el-form-item label="Request Timeout (ms)">
            <el-input-number
              v-model="tab.settings.timeoutMs"
              :min="500"
              :max="30000"
              :step="500"
            />
          </el-form-item>
          <el-form-item label="Auto-encode URL">
            <el-switch v-model="tab.settings.encodeUrl" />
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane
        :label="`Comments (${comments.length})`"
        name="comments"
      >
        <el-empty
          v-if="!tab.savedRequestId"
          description="Save this request to a Collection to collaborate with team comments"
          :image-size="48"
        />
        <div v-else style="display: flex; flex-direction: column; gap: 10px">
          <div style="display: flex; gap: 8px">
            <el-input
              v-model="newCommentText"
              size="small"
              :disabled="!ws.canEdit"
              placeholder="Write a comment or note for your team..."
              @keyup.enter="submitComment"
            />
            <el-button
              size="small"
              type="primary"
              :disabled="!ws.canEdit || !newCommentText.trim()"
              @click="submitComment"
            >
              Post
            </el-button>
          </div>
          <div
            v-for="c in comments"
            :key="c.id"
            style="
              padding: 8px 10px;
              border: 1px solid var(--ao-border);
              border-radius: 6px;
              background: var(--ao-surface-2);
            "
          >
            <div style="display: flex; justify-content: space-between; font-size: 11.5px; color: var(--ao-text-muted); margin-bottom: 4px">
              <strong>{{ c.user.name || c.user.email }}</strong>
              <div style="display: flex; align-items: center; gap: 8px">
                <span>{{ new Date(c.createdAt).toLocaleString() }}</span>
                <el-button
                  v-if="ws.canEdit"
                  :icon="Delete"
                  link
                  type="danger"
                  size="small"
                  @click="removeComment(c.id)"
                />
              </div>
            </div>
            <div style="font-size: 13px">{{ c.content }}</div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.request-pane {
  flex: 1;
  min-width: 0;
  min-height: 160px;
  overflow-y: auto;
  background: var(--ao-surface);
  border: none;
  border-radius: 0;
  padding: 8px 12px;
}
.body-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.code-area :deep(textarea) {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
}
.gql-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.binary-box {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px;
  border: 1px dashed var(--ao-border);
  border-radius: 6px;
}
@media (max-width: 640px) {
  .gql-grid {
    grid-template-columns: 1fr;
  }
}
</style>
