// Cross-platform wrapper around `npm run package[:target] --workspace @openharness/app`.
//
// This exists so the better-sqlite3 native module ends up rebuilt for
// Electron's ABI only while electron-builder is actually running, and gets
// restored to the host Node ABI afterward -- regardless of whether packaging
// succeeded or failed. Without the restore step, running this once locally
// would leave `npm test` / `npm run dev` broken (better-sqlite3 compiled for
// Electron can't load under plain Node) until a manual `npm rebuild`.
//
// This is a plain Node script instead of a shell one-liner because npm runs
// scripts through cmd.exe on Windows, where a POSIX `trap`/`$?`/subshell
// pattern for "run this, then always run that cleanup, then exit with the
// original code" doesn't work. `child_process` + try/finally does the same
// thing identically on Windows, Linux and macOS.
import { spawnSync } from 'node:child_process';

const target = process.argv[2]; // '', 'win', 'linux', or 'mac'
const packageScript = target ? `package:${target}` : 'package';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  return result.status ?? 1;
}

let exitCode = run('npm', ['run', 'build']);
if (exitCode === 0) {
  exitCode = run('node', ['scripts/rebuild-native.mjs']);
}
if (exitCode === 0) {
  exitCode = run('npm', ['run', packageScript, '--workspace', '@openharness/app']);
}

// Always restore, even if a step above failed, so a failed or successful
// packaging attempt never leaves the workspace's better-sqlite3 unusable
// under plain Node.
const restoreExitCode = run('npm', ['run', 'restore-native']);
if (exitCode === 0 && restoreExitCode !== 0) {
  exitCode = restoreExitCode;
}

process.exit(exitCode);