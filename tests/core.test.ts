import assert from 'node:assert/strict';
import test from 'node:test';
import { explainLocalHttpError, generateLocalTestsFromResponse } from '../apps/web/src/utils/aiAssistant.ts';
import { detectCollectionBreakingChanges } from '../apps/web/src/utils/breakingChangeDetector.ts';
import { validateJsonAgainstSchema } from '../apps/web/src/utils/schemaValidator.ts';
import { redactSecretsInText, scanTextForSecrets } from '../apps/web/src/utils/secretScanner.ts';

test('secretScanner detects and redacts API keys', () => {
  const sample = 'Authorization: Bearer sk-1234567890abcdefghijklmnop';
  const findings = scanTextForSecrets(sample, 'Headers');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].pattern, 'OpenAI / Stripe Secret Key');
  const redacted = redactSecretsInText(sample);
  assert.equal(redacted.includes('[REDACTED_SECRET]'), true);
});

test('schemaValidator validates required fields and types', () => {
  const schema = JSON.stringify({
    type: 'object',
    required: ['id', 'name'],
    properties: { id: { type: 'integer' }, name: { type: 'string' } },
  });
  assert.equal(validateJsonAgainstSchema('{"id": 1, "name": "Api-Open"}', schema).valid, true);
  const bad = validateJsonAgainstSchema('{"id": "oops"}', schema);
  assert.equal(bad.valid, false);
  assert.equal(bad.errors.length >= 2, true);
});

test('aiAssistant generates tests and explains HTTP errors locally', () => {
  const script = generateLocalTestsFromResponse(200, '{"id": 42, "ok": true}');
  assert.equal(script.includes('pm.expect(pm.response.code).to.equal(200)'), true);
  assert.equal(script.includes('to.have.property("id")'), true);
  const explanation = explainLocalHttpError(401, 'Invalid token');
  assert.equal(explanation.includes('Unauthorized (401)'), true);
});

test('breakingChangeDetector flags removed endpoints and auth changes', () => {
  const base = [
    {
      id: '1',
      collectionId: 'c1',
      name: 'Get Users',
      method: 'GET' as const,
      url: 'https://api.example.com/users',
      headers: [],
      queryParams: [],
      auth: { type: 'none' as const },
      body: { mode: 'none' as const },
    },
  ];
  const changes = detectCollectionBreakingChanges(base, []);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].severity, 'breaking');
});
