import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { discoverTests, planTests, verifyAuditedFiles } from '../scripts/test-scope.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const audit = JSON.parse(readFileSync(new URL('../scripts/no-accounts-audit.json', import.meta.url), 'utf8'));
// Validate before Vitest collects anything. No existing app/Worker setup is loaded.
verifyAuditedFiles(root, audit);
const plan = planTests({ scope: 'no-accounts', inventory: discoverTests(root), manifest: audit, root, sourceCommit: audit.sourceCommit });

export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  test: {
    environment: 'node',
    setupFiles: [],
    include: plan.rows.filter(row => row.disposition === 'run-web').map(row => row.path.slice('web/'.length)),
  },
});
