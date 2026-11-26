<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useSettingsStore } from '../stores/settings';
import { useWorkspaceStore } from '../stores/workspace';
import type { AuthModalMode } from '../types/app';

defineProps<{
  authVisible: boolean;
  passwordVisible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:authVisible', val: boolean): void;
  (e: 'update:passwordVisible', val: boolean): void;
}>();

const ws = useWorkspaceStore();
const settings = useSettingsStore();

const authMode = ref<AuthModalMode>('login');
const authEmail = ref('');
const authPassword = ref('');
const authSubmitting = ref(false);

const newAccountPassword = ref('');
const confirmAccountPassword = ref('');
const savingPassword = ref(false);

watch(
  () => ws.needsPasswordSetup,
  (val) => {
    if (val) emit('update:passwordVisible', true);
  },
);

async function handleAuthSubmit() {
  if (!authEmail.value.trim()) {
    ElMessage.warning('Please enter your email');
    return;
  }
  authSubmitting.value = true;
  try {
    if (authMode.value === 'login') {
      await ws.signIn(authEmail.value.trim(), authPassword.value);
      ElMessage.success('Signed in');
      emit('update:authVisible', false);
    } else if (authMode.value === 'register') {
      await ws.signUp(authEmail.value.trim(), authPassword.value);
      ElMessage.success('Verification email sent! Check your inbox to verify.');
      authMode.value = 'login';
    } else {
      await ws.signInWithOtp(authEmail.value.trim());
      ElMessage.success('Verification / login link sent to your email!');
      emit('update:authVisible', false);
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Auth failed');
  } finally {
    authSubmitting.value = false;
  }
}

async function handleResetPasswordEmail() {
  if (!authEmail.value.trim()) {
    ElMessage.warning(
      'Enter your email first to receive the Set / Reset Password link',
    );
    return;
  }
  authSubmitting.value = true;
  try {
    await ws.resetPasswordForEmail(authEmail.value.trim());
    ElMessage.success('Password setup / reset email sent! Check your inbox.');
  } catch (err) {
    ElMessage.error(
      err instanceof Error ? err.message : 'Failed to send password email',
    );
  } finally {
    authSubmitting.value = false;
  }
}

async function handleResendVerification() {
  if (!authEmail.value.trim()) {
    ElMessage.warning('Enter your email first');
    return;
  }
  authSubmitting.value = true;
  try {
    await ws.resendVerification(authEmail.value.trim());
    ElMessage.success('Verification email resent!');
  } catch (err) {
    ElMessage.error(
      err instanceof Error ? err.message : 'Failed to resend verification',
    );
  } finally {
    authSubmitting.value = false;
  }
}

const ssoExpanded = ref(false);
const ssoDomain = ref('');
async function handleSsoLogin() {
  if (!ssoDomain.value.trim()) {
    ElMessage.warning('Enter your organization SSO domain (e.g. acme.com)');
    return;
  }
  try {
    await ws.signInWithSso(ssoDomain.value.trim());
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Enterprise SSO failed');
  }
}

async function handleSaveNewPassword() {
  if (newAccountPassword.value.length < 6) {
    ElMessage.warning('Password must be at least 6 characters');
    return;
  }
  if (newAccountPassword.value !== confirmAccountPassword.value) {
    ElMessage.warning('Passwords do not match');
    return;
  }
  savingPassword.value = true;
  try {
    await ws.updatePassword(newAccountPassword.value);
    newAccountPassword.value = '';
    confirmAccountPassword.value = '';
    emit('update:passwordVisible', false);
    ElMessage.success('Password saved successfully!');
  } catch (err) {
    ElMessage.error(
      err instanceof Error ? err.message : 'Failed to update password',
    );
  } finally {
    savingPassword.value = false;
  }
}

async function handleOAuthLogin(provider: 'google' | 'github' | 'discord') {
  try {
    await ws.signInWithOAuth(provider);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'OAuth login failed');
  }
}
</script>

<template>
  <!-- Auth Dialog -->
  <el-dialog
    :model-value="authVisible"
    width="min(92vw, 430px)"
    align-center
    class="auth-modal-dialog"
    @update:model-value="emit('update:authVisible', $event)"
  >
    <template #header>
      <div class="auth-dialog-header">
        <img
          :src="
            settings.effectiveTheme === 'dark'
              ? '/API-OPEN-FULL.png'
              : '/API-OPEN-FULL-HITAM.png'
          "
          alt="Api-Open"
          class="auth-logo-wordmark"
        />
        <span class="auth-subtitle">
          Sign in to sync workspaces, collections &amp; environments
        </span>
      </div>
    </template>

    <div class="auth-mode-pills">
      <button
        type="button"
        class="auth-mode-pill"
        :class="{ active: authMode === 'login' }"
        @click="authMode = 'login'"
      >
        Sign In
      </button>
      <button
        type="button"
        class="auth-mode-pill"
        :class="{ active: authMode === 'register' }"
        @click="authMode = 'register'"
      >
        Register
      </button>
      <button
        type="button"
        class="auth-mode-pill"
        :class="{ active: authMode === 'magic' }"
        @click="authMode = 'magic'"
      >
        Email Link
      </button>
    </div>

    <el-form label-position="top" class="auth-form" @submit.prevent="handleAuthSubmit">
      <el-form-item label="Email Address">
        <el-input
          v-model="authEmail"
          size="large"
          type="email"
          placeholder="you@example.com"
        />
      </el-form-item>

      <el-form-item v-if="authMode !== 'magic'">
        <template #label>
          <div class="auth-pw-label-row">
            <span>Password</span>
            <el-button
              v-if="authMode === 'login'"
              link
              type="primary"
              size="small"
              :disabled="authSubmitting"
              @click="handleResetPasswordEmail"
            >
              Forgot / Set Password?
            </el-button>
          </div>
        </template>
        <el-input
          v-model="authPassword"
          size="large"
          type="password"
          placeholder="Enter your password"
          show-password
        />
      </el-form-item>

      <el-button
        type="primary"
        size="large"
        native-type="submit"
        :loading="authSubmitting"
        class="auth-submit-btn"
      >
        {{
          authMode === 'login'
            ? 'Sign In'
            : authMode === 'register'
              ? 'Create Account & Send Verification'
              : 'Send Email Verification Link'
        }}
      </el-button>

      <div v-if="authMode === 'register'" style="margin-top: 8px; text-align: center">
        <el-button
          link
          type="primary"
          size="small"
          :disabled="authSubmitting"
          @click="handleResendVerification"
        >
          Resend Verification Email
        </el-button>
      </div>
    </el-form>

    <el-divider class="auth-divider">or continue with</el-divider>

    <div class="oauth-buttons">
      <el-button class="oauth-btn" @click="handleOAuthLogin('google')">
        <svg viewBox="0 0 24 24" width="16" height="16" style="margin-right: 6px">
          <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.2-1.5 3.6-5.5 3.6-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.1 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z" />
        </svg>
        Google
      </el-button>
      <el-button class="oauth-btn" @click="handleOAuthLogin('github')">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="margin-right: 6px">
          <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
        </svg>
        GitHub
      </el-button>
      <el-button class="oauth-btn" @click="handleOAuthLogin('discord')">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="#5865F2" style="margin-right: 6px">
          <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.7 1.4a18.2 18.2 0 0 0-5.4 0L8.6 3a19.8 19.8 0 0 0-4.9 1.4C.6 9-.2 13.5.2 18a20 20 0 0 0 6 3l1.3-2.1c-.7-.3-1.4-.6-2-1 .2-.1.3-.3.5-.4a14.2 14.2 0 0 0 12 0l.5.4c-.6.4-1.3.7-2 1L17.8 21a20 20 0 0 0 6-3c.5-5.2-.8-9.7-3.5-13.6zM8.5 15.3c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4c1.2 0 2.2 1.1 2.1 2.4 0 1.3-.9 2.4-2.1 2.4zm7 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4c1.2 0 2.2 1.1 2.1 2.4 0 1.3-.9 2.4-2.1 2.4z" />
        </svg>
        Discord
      </el-button>
    </div>

    <div class="sso-section">
      <button
        type="button"
        class="sso-toggle-btn"
        @click="ssoExpanded = !ssoExpanded"
      >
        {{ ssoExpanded ? 'Hide Enterprise SSO' : 'Sign in with Enterprise SSO (SAML / OIDC)' }}
      </button>
      <div v-if="ssoExpanded" class="sso-input-row">
        <el-input
          v-model="ssoDomain"
          size="default"
          placeholder="Company domain (e.g. acme.com)"
          @keyup.enter="handleSsoLogin"
        />
        <el-button type="primary" plain @click="handleSsoLogin">Continue</el-button>
      </div>
    </div>
  </el-dialog>

  <!-- Set / Update Password Dialog -->
  <el-dialog
    :model-value="passwordVisible"
    title="Set / Update Password"
    width="min(92vw, 380px)"
    align-center
    @update:model-value="emit('update:passwordVisible', $event)"
  >
    <el-form label-position="top" @submit.prevent="handleSaveNewPassword">
      <el-form-item label="New Password">
        <el-input
          v-model="newAccountPassword"
          type="password"
          placeholder="Minimum 6 characters"
          show-password
        />
      </el-form-item>
      <el-form-item label="Confirm Password">
        <el-input
          v-model="confirmAccountPassword"
          type="password"
          placeholder="Repeat new password"
          show-password
        />
      </el-form-item>
      <el-button
        type="primary"
        native-type="submit"
        :loading="savingPassword"
        style="width: 100%"
      >
        Save Password
      </el-button>
    </el-form>
  </el-dialog>
</template>

<style scoped>
.auth-dialog-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
  padding-top: 6px;
}
.auth-logo-wordmark {
  height: 44px;
  width: auto;
  object-fit: contain;
}
.auth-subtitle {
  font-size: 12.5px;
  color: var(--ao-text-muted);
}
.auth-mode-pills {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: var(--ao-surface-2);
  border: 1px solid var(--ao-border);
  margin-bottom: 16px;
}
.auth-mode-pill {
  border: none;
  background: transparent;
  color: var(--ao-text-muted);
  font-size: 12.5px;
  font-weight: 600;
  padding: 7px 8px;
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
}
.auth-mode-pill:hover {
  color: var(--ao-text);
}
.auth-mode-pill.active {
  background: var(--ao-surface);
  color: var(--el-color-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.auth-form :deep(.el-form-item__label) {
  width: 100%;
  font-size: 12.5px;
  font-weight: 600;
  padding-bottom: 4px;
}
.auth-pw-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.auth-submit-btn {
  width: 100%;
  margin-top: 4px;
  font-weight: 600;
  border-radius: 8px;
}
.auth-divider {
  margin: 18px 0 14px;
  font-size: 12px;
}
.oauth-buttons {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.oauth-buttons :deep(.el-button + .el-button) {
  margin-left: 0;
}
.oauth-btn {
  height: 38px;
  border-radius: 8px;
  font-weight: 500;
}
.sso-section {
  margin-top: 14px;
  text-align: center;
}
.sso-toggle-btn {
  border: none;
  background: transparent;
  color: var(--ao-text-muted);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 8px;
}
.sso-toggle-btn:hover {
  color: var(--el-color-primary);
  text-decoration: underline;
}
.sso-input-row {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
</style>
