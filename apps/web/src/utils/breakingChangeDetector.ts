import type { ApiRequestDto } from '../stores/workspace';

export interface BreakingChangeItem {
  severity: 'breaking' | 'warning' | 'info';
  endpoint: string;
  message: string;
}

export function detectCollectionBreakingChanges(
  baseline: ApiRequestDto[],
  current: ApiRequestDto[],
): BreakingChangeItem[] {
  const changes: BreakingChangeItem[] = [];
  const curMap = new Map(current.map((r) => [`${r.method} ${r.url}`, r]));
  const baseMap = new Map(baseline.map((r) => [`${r.method} ${r.url}`, r]));

  for (const [key, oldReq] of baseMap.entries()) {
    const newReq = curMap.get(key);
    if (!newReq) {
      changes.push({
        severity: 'breaking',
        endpoint: key,
        message: `Endpoint removed or path/method changed ("${oldReq.name}")`,
      });
      continue;
    }
    const oldParams = new Set((oldReq.queryParams ?? []).filter((p) => p.enabled).map((p) => p.key));
    const newParams = new Set((newReq.queryParams ?? []).filter((p) => p.enabled).map((p) => p.key));
    for (const p of newParams) {
      if (!oldParams.has(p)) {
        changes.push({
          severity: 'warning',
          endpoint: key,
          message: `New query parameter "${p}" added`,
        });
      }
    }
    if ((oldReq.auth?.type ?? 'none') !== (newReq.auth?.type ?? 'none')) {
      changes.push({
        severity: 'breaking',
        endpoint: key,
        message: `Auth changed from "${oldReq.auth?.type ?? 'none'}" to "${newReq.auth?.type ?? 'none'}"`,
      });
    }
  }

  for (const [key, newReq] of curMap.entries()) {
    if (!baseMap.has(key)) {
      changes.push({
        severity: 'info',
        endpoint: key,
        message: `New endpoint added ("${newReq.name}")`,
      });
    }
  }

  return changes;
}
