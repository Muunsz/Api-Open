<script setup lang="ts">
import type { CollectionDto } from '../stores/workspace';
import type { GqlFieldSummary } from '../utils/graphqlIntrospection';
import {
  ApiDocsDialog,
  CodeSnippetDialog,
  CollectionSettingsDialog,
  CollectionSnapshotsDialog,
  DbClientDialog,
  DownloadAppDialog,
  FlowsDialog,
  GitSyncDialog,
  GraphqlSchemaDialog,
  ImportCurlDialog,
  KeyboardShortcutsDrawer,
  MobileSidebarDrawer,
  MonitorsDialog,
  NewCollectionDialog,
  OpenApiViewerDialog,
  ProxyRecorderDialog,
  QuickSearchDialog,
  SaveRequestDialog,
  SchemasDialog,
} from './modals';

defineProps<{
  saveVisible: boolean;
  initialSaveRequestName?: string;
  initialSaveCollectionId?: string;
  newCollectionVisible: boolean;
  curlVisible: boolean;
  snippetVisible: boolean;
  docsVisible: boolean;
  docsCollectionId?: string;
  docsTitle: string;
  docsMarkdown: string;
  gqlSchemaVisible: boolean;
  gqlQueries: GqlFieldSummary[];
  gqlMutations: GqlFieldSummary[];
  mobileSidebarVisible: boolean;
  searchVisible: boolean;
  shortcutsVisible: boolean;
  downloadAppVisible: boolean;
  collectionSettingsVisible: boolean;
  collectionSettingsTarget: CollectionDto | null;
  specViewerVisible: boolean;
  monitorsVisible: boolean;
  flowsVisible: boolean;
  dbClientVisible: boolean;
  schemasVisible: boolean;
  proxyRecorderVisible: boolean;
  snapshotsVisible: boolean;
  snapshotsTarget: CollectionDto | null;
  gitSyncVisible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:saveVisible', val: boolean): void;
  (e: 'update:newCollectionVisible', val: boolean): void;
  (e: 'update:curlVisible', val: boolean): void;
  (e: 'update:snippetVisible', val: boolean): void;
  (e: 'update:docsVisible', val: boolean): void;
  (e: 'update:gqlSchemaVisible', val: boolean): void;
  (e: 'update:mobileSidebarVisible', val: boolean): void;
  (e: 'update:searchVisible', val: boolean): void;
  (e: 'update:shortcutsVisible', val: boolean): void;
  (e: 'update:downloadAppVisible', val: boolean): void;
  (e: 'update:collectionSettingsVisible', val: boolean): void;
  (e: 'update:specViewerVisible', val: boolean): void;
  (e: 'update:monitorsVisible', val: boolean): void;
  (e: 'update:flowsVisible', val: boolean): void;
  (e: 'update:dbClientVisible', val: boolean): void;
  (e: 'update:schemasVisible', val: boolean): void;
  (e: 'update:proxyRecorderVisible', val: boolean): void;
  (e: 'update:snapshotsVisible', val: boolean): void;
  (e: 'update:gitSyncVisible', val: boolean): void;
  (e: 'trigger-postman-import'): void;
  (e: 'open-auth'): void;
}>();
</script>

<template>
  <SaveRequestDialog
    :visible="saveVisible"
    :initial-request-name="initialSaveRequestName"
    :initial-collection-id="initialSaveCollectionId"
    @update:visible="emit('update:saveVisible', $event)"
  />

  <NewCollectionDialog
    :visible="newCollectionVisible"
    @update:visible="emit('update:newCollectionVisible', $event)"
  />

  <ImportCurlDialog
    :visible="curlVisible"
    @update:visible="emit('update:curlVisible', $event)"
  />

  <CodeSnippetDialog
    :visible="snippetVisible"
    @update:visible="emit('update:snippetVisible', $event)"
  />

  <ApiDocsDialog
    :visible="docsVisible"
    :collection-id="docsCollectionId"
    :docs-title="docsTitle"
    :docs-markdown="docsMarkdown"
    @update:visible="emit('update:docsVisible', $event)"
  />

  <GraphqlSchemaDialog
    :visible="gqlSchemaVisible"
    :queries="gqlQueries"
    :mutations="gqlMutations"
    @update:visible="emit('update:gqlSchemaVisible', $event)"
  />

  <MobileSidebarDrawer
    :visible="mobileSidebarVisible"
    @update:visible="emit('update:mobileSidebarVisible', $event)"
    @open-new-collection="emit('update:newCollectionVisible', true)"
    @trigger-postman-import="emit('trigger-postman-import')"
    @open-auth="emit('open-auth')"
  />

  <QuickSearchDialog
    :visible="searchVisible"
    @update:visible="emit('update:searchVisible', $event)"
  />

  <KeyboardShortcutsDrawer
    :visible="shortcutsVisible"
    @update:visible="emit('update:shortcutsVisible', $event)"
  />

  <DownloadAppDialog
    :visible="downloadAppVisible"
    @update:visible="emit('update:downloadAppVisible', $event)"
  />

  <CollectionSettingsDialog
    :visible="collectionSettingsVisible"
    :collection="collectionSettingsTarget"
    @update:visible="emit('update:collectionSettingsVisible', $event)"
  />

  <OpenApiViewerDialog
    :visible="specViewerVisible"
    @update:visible="emit('update:specViewerVisible', $event)"
  />

  <MonitorsDialog
    :visible="monitorsVisible"
    @update:visible="emit('update:monitorsVisible', $event)"
  />

  <FlowsDialog
    :visible="flowsVisible"
    @update:visible="emit('update:flowsVisible', $event)"
  />

  <DbClientDialog
    :visible="dbClientVisible"
    @update:visible="emit('update:dbClientVisible', $event)"
  />

  <SchemasDialog
    :visible="schemasVisible"
    @update:visible="emit('update:schemasVisible', $event)"
  />

  <ProxyRecorderDialog
    :visible="proxyRecorderVisible"
    @update:visible="emit('update:proxyRecorderVisible', $event)"
  />

  <CollectionSnapshotsDialog
    :visible="snapshotsVisible"
    :collection="snapshotsTarget"
    @update:visible="emit('update:snapshotsVisible', $event)"
  />

  <GitSyncDialog
    :visible="gitSyncVisible"
    @update:visible="emit('update:gitSyncVisible', $event)"
  />
</template>
