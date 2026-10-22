import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { deploymentEnvironment } from '../scripts/build-neon-deployment.mjs';

const config = JSON.parse(readFileSync(new URL('../deploy/neon-production.json', import.meta.url)));

test('deploy usa o destino aprovado mesmo quando o ambiente local aponta para ensaio', () => {
  const env = deploymentEnvironment(config, { VITE_NEON_AUTH_URL: 'https://fixture.invalid/auth', OTHER_SETTING: 'preserved' });
  assert.equal(env.VITE_NEON_AUTH_URL, config.auth_url);
  assert.equal(env.VITE_NEON_DATA_API_URL, config.data_api_url);
  assert.equal(env.OTHER_SETTING, 'preserved');
});

test('deploy recusa outro projeto, fixtures e credenciais embutidas na URL', () => {
  for (const other of [
    { ...config, branch_id: 'br-fixture' },
    { ...config, auth_url: config.auth_url.replace('ep-late-water-b53akznr', 'ep-fixture') },
    { ...config, auth_url: config.auth_url.replace('https://', 'https://user:password@') },
    { ...config, data_api_url: config.data_api_url + '?token=fixture' },
  ]) assert.throws(() => deploymentEnvironment(other));
});
