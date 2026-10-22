// Apenas configuração pública de build; nenhuma credencial administrativa.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function deploymentEnvironment(config, inherited = process.env) {
  if (config.project_id !== 'floral-pond-94925356' || config.branch_id !== 'br-muddy-term-b5xvw6i7') {
    throw new Error('O build deve usar o destino de produção revisado para este corte.');
  }
  for (const [key, host, path] of [
    ['auth_url', 'ep-late-water-b53akznr.neonauth.c-7.us-east-2.aws.neon.tech', '/neondb/auth'],
    ['data_api_url', 'ep-late-water-b53akznr.apirest.c-7.us-east-2.aws.neon.tech', '/neondb/rest/v1'],
  ]) {
    const url = new URL(config[key]);
    if (url.protocol !== 'https:' || url.host !== host || url.pathname !== path || url.username || url.password || url.search || url.hash) {
      throw new Error('URL de deploy diverge do endpoint público autorizado.');
    }
  }
  return { ...inherited, VITE_NEON_AUTH_URL: config.auth_url, VITE_NEON_DATA_API_URL: config.data_api_url };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const config = JSON.parse(readFileSync(new URL('../deploy/neon-production.json', import.meta.url), 'utf8'));
  const result = spawnSync(process.execPath, ['scripts/run-framework.mjs', 'build'], {
    cwd: root, env: deploymentEnvironment(config), stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}
