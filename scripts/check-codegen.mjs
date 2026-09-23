import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const output = mkdtempSync(join(tmpdir(), 'rn-network-quality-codegen-'));
const script = join(
  process.cwd(),
  'node_modules/react-native/scripts/generate-codegen-artifacts.js'
);

try {
  const result = spawnSync(
    process.execPath,
    [script, '-p', process.cwd(), '-t', 'all', '-o', output, '-s', 'library'],
    { encoding: 'utf8', stdio: 'inherit' }
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
} finally {
  rmSync(output, { recursive: true, force: true });
}
