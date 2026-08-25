import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Build the workspace if tsc is available. This runs during `npm install` and
// may be skipped in CI environments that prune dev dependencies before the
// install step. A missing tsc is not an error — the build will fail loudly
// later if the workspace is genuinely broken.
const tscBin = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
if (existsSync(tscBin)) {
  try {
    execSync(`"${tscBin}" -b`, { stdio: 'inherit' });
  } catch (e) {
    process.exit(1);
  }
}
