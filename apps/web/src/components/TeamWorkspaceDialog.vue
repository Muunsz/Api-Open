<script setup lang="ts">
import { ref, watch } from 'vue';
import { Delete } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { useConsoleStore } from '../stores/console';
import { useWorkspaceStore } from '../stores/workspace';
import type { WorkspaceRole } from '../types/workspace';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const ws = useWorkspaceStore();
const consoleStore = useConsoleStore();
const activeTab = ref<'members' | 'audit'>('members');

watch(
  () => props.visible,
  (vis) => {
    if (vis) {
      ws.ensureMembersLoaded();
      consoleStore.syncFromDb();
    }
  },
);
const newTeamName = ref('');
const inviteEmail = ref('');
const inviteRole = ref<WorkspaceRole>('EDITOR');
const inviting = ref(false);

async function handleCreateTeam() {
  if (!newTeamName.value.trim()) return;
  await ws.createTeamWorkspace(newTeamName.value);
  newTeamName.value = '';
  ElMessage.success('Team workspace created');
}

async function handleInviteMember() {
  if (!inviteEmail.value.trim()) return;
  inviting.value = true;
  try {
    const res = await ws.inviteMember(inviteEmail.value, inviteRole.value);
    inviteEmail.value = '';
    if (res.addedImmediately) {
      ElMessage.success('Member added & push notification sent to their account');
    } else {
      ElMessage.warning(
        'Account with this email is not registered yet. Ask them to sign up first.',
      );
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Invite failed');
  } finally {
    inviting.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Team Workspaces, Roles & Audit Trail"
    width="min(94vw, 680px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-tabs v-model="activeTab">
      <el-tab-pane label="Members & Roles" name="members">
        <div class="env-create-row">
          <el-input
            v-model="newTeamName"
            size="small"
            placeholder="New team workspace name"
            style="max-width: 240px"
          />
          <el-button size="small" type="primary" @click="handleCreateTeam">
            Create Team Workspace
          </el-button>
        </div>

        <el-divider>Invite Member to Current Workspace</el-divider>
        <div class="env-create-row">
          <el-input
            v-model="inviteEmail"
            size="small"
            placeholder="teammate@example.com"
            style="max-width: 240px"
          />
          <el-select v-model="inviteRole" size="small" style="width: 110px">
            <el-option label="Editor" value="EDITOR" />
            <el-option label="Viewer" value="VIEWER" />
            <el-option label="Owner" value="OWNER" />
          </el-select>
          <el-button
            size="small"
            type="primary"
            :loading="inviting"
            @click="handleInviteMember"
          >
            Send Invite
          </el-button>
        </div>

        <el-table :data="ws.members" size="small" border>
          <el-table-column label="Email" prop="user.email" />
          <el-table-column label="Role" width="130">
            <template #default="{ row }">
              <el-select
                v-if="ws.currentUserRole === 'OWNER' && row.userId !== ws.user?.id"
                :model-value="row.role"
                size="small"
                @change="(val: WorkspaceRole) => ws.updateMemberRole(row.id, val)"
              >
                <el-option label="Owner" value="OWNER" />
                <el-option label="Editor" value="EDITOR" />
                <el-option label="Viewer" value="VIEWER" />
              </el-select>
              <span v-else>{{ row.role }}</span>
            </template>
          </el-table-column>
          <el-table-column width="70" align="center">
            <template #default="{ row }">
              <el-button
                v-if="ws.currentUserRole === 'OWNER' && row.userId !== ws.user?.id"
                :icon="Delete"
                link
                type="danger"
                size="small"
                @click="ws.removeMember(row.id)"
              />
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane :label="`Audit Trail (${ws.auditLogs.length + consoleStore.logs.length})`" name="audit">
        <el-table :data="[...ws.auditLogs.map((a) => ({ id: a.id, type: 'AUDIT', message: `${a.actor}: ${a.action} (${a.target})`, timestamp: a.timestamp })), ...consoleStore.logs.slice(0, 50)]" size="small" border max-height="320">
          <el-table-column prop="type" label="Type" width="85" />
          <el-table-column prop="message" label="Activity" />
          <el-table-column label="Time" width="140">
            <template #default="{ row }">{{ row.timestamp.slice(11, 19) }}</template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>

<style scoped>
.env-create-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
</style>
