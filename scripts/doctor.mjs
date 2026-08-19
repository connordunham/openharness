#!/usr/bin/env node
/**
 * Preflight check. Answers "why won't this build on my machine?" without
 * making anyone read a stack trace.
 *
 * Run it with `npm run doctor`. It checks the things that have actually gone
 * wrong on real machines, in the order they bite, and prints the exact fix
 * rather than a diagnosis.
 */
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m, fix) => { console.log(`  FAIL  ${m}`); problems.push({ m, fix }); };
const warn = (m, fix) => { console.log(`  warn  ${m}`); notes.push({ m, fix }); };

console.log('\nOpenHarness doctor\n');

// --- Node ------------------------------------------------------------------
const required = { major: 20, minor: 19 };
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj > required.major || (maj === required.major && min >= required.minor)) {
  ok(`Node ${process.versions.node}`);
} else {
  bad(
    `Node ${process.versions.node} is too old (need >= ${required.major}.${required.minor})`,
    'Install Node 22 LTS from https://nodejs.org — take the LTS installer and accept the defaults.\n' +
      '        If you use nvm: `nvm install 22 && nvm use 22` (this repo has a .nvmrc).',
  );
}

if (maj >= 23) {
  warn(
    `Node ${process.versions.node} is newer than anything this project is tested on (CI uses 22)`,
    'If something behaves oddly, try Node 22 LTS before assuming the bug is ours.',
  );
}

// --- npm -------------------------------------------------------------------
try {
  const npmVersion = execSync('npm --version', { encoding: 'utf-8' }).trim();
  ok(`npm ${npmVersion}`);
} catch {
  bad('npm is not on PATH', 'Reinstall Node from https://nodejs.org — npm ships with it.');
}

// --- the wrong package manager ---------------------------------------------
if (existsSync(join(root, 'pnpm-lock.yaml')) || existsSync(join(root, 'yarn.lock'))) {
  bad(
    'a pnpm or yarn lockfile is present',
    'This project is npm-only. Delete the stray lockfile and node_modules, then `npm install`.',
  );
}

// --- installed? ------------------------------------------------------------
if (!existsSync(join(root, 'node_modules'))) {
  bad('node_modules is missing', 'Run `npm install`.');
} else {
  ok('node_modules present');
}

// --- the one that actually bites: unbuilt workspace libraries --------------
const libs = ['core', 'io', 'render'];
const unbuilt = libs.filter((p) => !existsSync(join(root, 'packages', p, 'dist', 'index.js')));
if (unbuilt.length) {
  bad(
    `workspace libraries not compiled: ${unbuilt.join(', ')}`,
    'Run `npm run build`. These packages are consumed through their built output\n' +
      '        (`main: ./dist/index.js`), so anything importing them fails until they have\n' +
      '        been compiled once. This is what produces\n' +
      '        "[commonjs--resolver] Failed to resolve entry for package @openharness/core".',
  );
} else {
  ok('workspace libraries compiled');
}

// --- Electron binary -------------------------------------------------------
const electronDir = join(root, 'node_modules', 'electron');
if (existsSync(electronDir)) {
  if (existsSync(join(electronDir, 'path.txt')) || existsSync(join(electronDir, 'dist'))) {
    ok('Electron binary downloaded');
  } else {
    bad(
      'the electron package is installed but its binary is missing',
      'The ~100 MB download failed and left nothing to retry from. Run\n' +
        '        `node node_modules/electron/install.js`, or delete node_modules and\n' +
        '        `npm install` again. Behind a corporate proxy, set ELECTRON_MIRROR or use\n' +
        '        the prebuilt installer from the Releases page instead of building.',
    );
  }
} else if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
  warn('Electron skipped (ELECTRON_SKIP_BINARY_DOWNLOAD is set)', 'Fine for tests; the app will not launch.');
} else {
  warn('electron is not installed', 'Run `npm install` from the repo root, not from a package directory.');
}

// --- PowerShell execution policy (Windows) ---------------------------------
if (process.platform === 'win32') {
  try {
    const policy = execSync('powershell -NoProfile -Command "Get-ExecutionPolicy -Scope CurrentUser"', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (policy === 'Restricted' || policy === 'Undefined' || policy === 'AllSigned') {
      warn(
        `PowerShell execution policy for your user is "${policy}"`,
        'npx and npm run may fail with "npm.ps1 cannot be loaded because running scripts\n' +
          '        is disabled". Either run commands from cmd.exe, or fix it once with\n' +
          '        `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.\n' +
          '        This one silently turns a failed build into a build that looks like it passed.',
      );
    } else {
      ok(`PowerShell execution policy: ${policy}`);
    }
  } catch {
    // Not fatal — if we cannot read it, we cannot advise on it.
  }

  // Only matters if you are packaging installers, but it is a baffling failure
  // when it hits, so name it rather than let people read a 7-Zip error.
  try {
    const dev = execSync(
      'powershell -NoProfile -Command "(Get-ItemProperty -Path HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock -Name AllowDevelopmentWithoutDevLicense -ErrorAction SilentlyContinue).AllowDevelopmentWithoutDevLicense"',
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (dev !== '1') {
      warn(
        'Windows Developer Mode is off',
        'Only matters for `npm run package`. electron-builder unpacks a signing toolchain\n' +
          '        that contains symlinks, and Windows refuses to create those without Developer\n' +
          '        Mode or admin rights. It fails with "Cannot create symbolic link: A required\n' +
          '        privilege is not held by the client", which does not sound like what it is.\n' +
          '        Turn it on in Settings > System > For developers, or just let CI build the\n' +
          '        installers (.github/workflows/release.yml) and skip this entirely.',
      );
    } else {
      ok('Windows Developer Mode is on (needed only for `npm run package`)');
    }
  } catch {
    // Cannot read it; not worth failing over.
  }

  if (root.toLowerCase().includes('onedrive')) {
    warn(
      'the repo is inside a OneDrive folder',
      'OneDrive turns unsynced files into reparse points, which breaks builds in ways\n' +
        '        that look like random file-not-found errors. Clone somewhere outside OneDrive.',
    );
  }
}

// --- version sanity --------------------------------------------------------
try {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
  ok(`OpenHarness ${pkg.version}`);
} catch {
  bad('cannot read package.json', 'Are you running this from inside the repository?');
}

// --- report ----------------------------------------------------------------
console.log('');
if (notes.length) {
  console.log('Worth knowing\n');
  for (const n of notes) console.log(`  - ${n.m}\n        ${n.fix}\n`);
}
if (problems.length) {
  console.log(`${problems.length} problem${problems.length > 1 ? 's' : ''} to fix, in order:\n`);
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p.m}\n        ${p.fix}\n`));
  console.log('If you only want to *use* OpenHarness, you do not need any of this —');
  console.log('download an installer from the Releases page instead.\n');
  process.exit(1);
}
console.log('No problems found. `npm start` should work.\n');
