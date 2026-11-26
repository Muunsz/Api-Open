#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';

interface CliRequest {
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

function resolveVars(input: string, env: Record<string, string>): string {
  return input.replace(/\{\{\s*(\$?[a-zA-Z0-9_.-]+)\s*\}\}/g, (m, k: string) => {
    if (k in env) return env[k];
    if (k === '$timestamp') return String(Math.floor(Date.now() / 1000));
    if (k === '$guid' || k === '$uuid') return crypto.randomUUID();
    if (k === '$randomInt') return String(Math.floor(Math.random() * 1000));
    return m;
  });
}

function extractRequests(col: any): CliRequest[] {
  const out: CliRequest[] = [];
  // Postman v2.1
  if (Array.isArray(col.item)) {
    const walk = (items: any[]) => {
      for (const it of items) {
        if (Array.isArray(it.item)) walk(it.item);
        else if (it.request) {
          const r = it.request;
          const url = typeof r.url === 'string' ? r.url : r.url?.raw || '';
          const headers: Record<string, string> = {};
          for (const h of r.header ?? []) {
            if (!h.disabled && h.key) headers[h.key] = h.value ?? '';
          }
          out.push({
            name: it.name || url,
            method: (r.method || 'GET').toUpperCase(),
            url,
            headers,
            body: r.body?.raw,
          });
        }
      }
    };
    walk(col.item);
  }
  // Hoppscotch
  else if (Array.isArray(col.requests) || Array.isArray(col.folders)) {
    const walkHopp = (node: any) => {
      for (const r of node.requests ?? []) {
        const headers: Record<string, string> = {};
        for (const h of r.headers ?? []) {
          if (h.active !== false && h.key) headers[h.key] = h.value ?? '';
        }
        out.push({
          name: r.name || r.endpoint || r.url,
          method: (r.method || 'GET').toUpperCase(),
          url: r.endpoint || r.url || '',
          headers,
          body: typeof r.body?.body === 'string' ? r.body.body : undefined,
        });
      }
      for (const f of node.folders ?? []) walkHopp(f);
    };
    walkHopp(col);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const colArg = args[0];
  if (!colArg || colArg === '--help' || colArg === '-h') {
    console.log('Usage: api-open <collection.json> [--env <environment.json>]');
    process.exit(0);
  }

  const envIdx = args.indexOf('--env');
  const envVars: Record<string, string> = {};
  if (envIdx >= 0 && args[envIdx + 1]) {
    const envJson = JSON.parse(fs.readFileSync(path.resolve(args[envIdx + 1]), 'utf8'));
    for (const v of envJson.values ?? envJson.variables ?? []) {
      if (v.enabled !== false && v.key) envVars[v.key] = String(v.value ?? '');
    }
  }

  const colJson = JSON.parse(fs.readFileSync(path.resolve(colArg), 'utf8'));
  const requests = extractRequests(colJson);
  console.log(`\nRunning ${requests.length} request(s)...\n`);

  let passed = 0;
  let failed = 0;

  for (const req of requests) {
    const url = resolveVars(req.url, envVars);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      headers[resolveVars(k, envVars)] = resolveVars(v, envVars);
    }
    const body = req.body ? resolveVars(req.body, envVars) : undefined;
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      });
      const ms = Date.now() - t0;
      if (res.ok) {
        passed++;
        console.log(`  PASS [${res.status}] ${req.method} ${req.name} (${ms}ms)`);
      } else {
        failed++;
        console.log(`  FAIL [${res.status}] ${req.method} ${req.name} (${ms}ms)`);
      }
    } catch (err) {
      failed++;
      console.log(`  ERR  ${req.method} ${req.name} — ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
