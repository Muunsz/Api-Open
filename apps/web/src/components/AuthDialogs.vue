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
    width="min(92vw, 400px)"
    align-center
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
        <el-text size="small" type="info">
          Sign in to sync workspaces, collections &amp; environments
        </el-text>
      </div>
    </template>
    <el-tabs v-model="authMode" stretch>
      <el-tab-pane label="Sign In" name="login" />
      <el-tab-pane label="Register" name="register" />
      <el-tab-pane label="Email Link" name="magic" />
    </el-tabs>
    <el-form label-position="top" @submit.prevent="handleAuthSubmit">
      <el-form-item label="Email">
        <el-input
          v-model="authEmail"
          type="email"
          placeholder="you@example.com"
        />
      </el-form-item>
      <el-form-item v-if="authMode !== 'magic'" label="Password">
        <el-input v-model="authPassword" type="password" show-password />
      </el-form-item>
      <el-button
        type="primary"
        native-type="submit"
        :loading="authSubmitting"
        style="width: 100%"
      >
        {{
          authMode === 'login'
            ? 'Sign In'
            : authMode === 'register'
              ? 'Create Account & Send Verification'
              : 'Send Email Verification Link'
        }}
      </el-button>
      <div
        style="display: flex; justify-content: space-between; margin-top: 8px"
      >
        <el-button
          v-if="authMode === 'login'"
          link
          type="primary"
          size="small"
          :disabled="authSubmitting"
          @click="handleResetPasswordEmail"
        >
          Forgot / Set Password via Email?
        </el-button>
        <el-button
          v-if="authMode === 'register'"
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

    <el-divider>or continue with</el-divider>
    <div class="oauth-buttons">
      <el-button @click="handleOAuthLogin('google')">Google</el-button>
      <el-button @click="handleOAuthLogin('github')">GitHub</el-button>
      <el-button @click="handleOAuthLogin('discord')">Discord</el-button>
    </div>
    <div style="display: flex; gap: 6px; margin-top: 10px">
      <el-input
        v-model="ssoDomain"
        size="small"
        placeholder="Enterprise SSO domain (SAML/OIDC, e.g. acme.com)"
      />
      <el-button size="small" @click="handleSsoLogin">SSO</el-button>
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
  gap: 6px;
  padding-top: 4px;
}
.auth-logo-wordmark {
  height: 44px;
  width: auto;
  object-fit: contain;
}
.oauth-buttons {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.oauth-buttons :deep(.el-button + .el-button) {
  margin-left: 0;
}
</style>
