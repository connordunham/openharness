// Rebuilds native modules (better-sqlite3) against Electron's Node ABI.
//
// This exists instead of electron-builder's built-in `npmRebuild` option
// because that option runs its own "install production dependencies" pass
// scoped to packages/app, and in an npm workspace that pass prunes
// hoisted root node_modules packages electron-builder itself still needs
// (electron, 7zip-bin) -- the packaging step then fails with ENOENT partway
// through, having already deleted the very binaries it's about to reach for.
// Rebuilding the native module directly, in place, avoids that dependency
// reinstall entirely. electron-builder.cjs sets `npmRebuild: false` to
// disable its own version of this step.
//
// Two details matter here:
//
// 1. `--module-dir` must point at the workspace package that actually
//    declares better-sqlite3 as a dependency (packages/parts), not the repo
//    root. electron-rebuild discovers "which modules are native" by reading
//    dependencies/devDependencies/optionalDependencies off the package.json
//    at --module-dir and walking that graph -- it does not know about npm
//    workspaces, so pointed at the root (whose own package.json never lists
//    better-sqlite3 directly) it silently finds nothing to rebuild and exits
//    "successfully" having done nothing.
//
// 2. `--build-from-source` is required. Without it, electron-rebuild prefers
//    prebuild-install, which in this environment has been observed to
//    silently keep/serve a binary built for the host Node ABI instead of
//    Electron's ABI -- again "succeeding" while doing nothing useful. Forcing
//    a from-source build with node-gyp against the downloaded Electron
//    headers is what actually guarantees the right ABI.
//
// Because both failure modes above look identical to success (exit 0, no
// error), this script verifies the result itself rather than trusting the
// rebuild command's exit code: it loads the compiled binary's ABI version out
// of better-sqlite3's own build config and compares it against the ABI
// electron-rebuild was told to target.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const electronVersion = JSON.parse(
  execSync('node -e "process.stdout.write(JSON.stringify(require(\'electron/package.json\').version))"').toString()
);

console.log(`Rebuilding native modules for Electron ${electronVersion}...`);
execSync(
  `npx electron-rebuild --version ${electronVersion} --module-dir packages/parts --only better-sqlite3 --force --build-from-source`,
  { stdio: 'inherit' }
);

// Verify: read the ABI actually baked into the compiled binary and compare
// it against the ABI electron-rebuild was told to target. A silent no-op (as
// described above) leaves the binary at the host Node's ABI instead.
const configPath = join(process.cwd(), 'node_modules/better-sqlite3/build/config.gypi');
let configText;
try {
  configText = readFileSync(configPath, 'utf8');
} catch (e) {
  console.error(
    `Native rebuild verification FAILED: could not read ${configPath} (${e.code}). ` +
      `This usually means the rebuild used a downloaded prebuilt binary instead of compiling ` +
      `from source, so no build config was written -- the binary's actual target can't be confirmed.`
  );
  process.exit(1);
}
const abiMatch = configText.match(/"node_module_version"\s*:\s*"?(\d+)"?/);
const runtimeMatch = configText.match(/"runtime"\s*:\s*"([^"]+)"/);
const builtAbi = abiMatch && abiMatch[1];
const builtRuntime = runtimeMatch && runtimeMatch[1];

const expectedAbi = JSON.parse(
  execSync(
    `node -e "process.stdout.write(JSON.stringify(require('node-abi').getAbi('${electronVersion}', 'electron')))"`
  ).toString()
);

if (builtRuntime !== 'electron' || String(builtAbi) !== String(expectedAbi)) {
  console.error(
    `Native rebuild verification FAILED: better-sqlite3 was built for runtime=${builtRuntime} abi=${builtAbi}, ` +
      `expected runtime=electron abi=${expectedAbi} (Electron ${electronVersion}). ` +
      `The build silently produced a binary for the wrong target.`
  );
  process.exit(1);
}

console.log(`Verified: better-sqlite3 rebuilt for Electron ${electronVersion} (ABI ${expectedAbi}).`);