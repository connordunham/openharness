/**
 * Packaging config for the distributable desktop app.
 *
 * The point of this file is that nobody should need Node, npm or a toolchain
 * to run OpenHarness. CI builds installers from a tag and attaches them to a
 * GitHub Release; a user downloads one file and double-clicks it.
 *
 * Three things here are not obvious, and all are consequences of this being an
 * npm workspace rather than a standalone app:
 *
 * 1. `electronVersion` is resolved at runtime rather than written down. npm
 *    hoists `electron` to the root node_modules, but electron-builder looks
 *    for it under the app package and gives up with "Cannot compute electron
 *    version from installed node modules". Resolving it through require()
 *    finds the hoisted copy and keeps this file from drifting out of step with
 *    the devDependency -- which is why this is a .cjs config and not the
 *    friendlier .yml.
 *
 * 2. Production dependencies (including @openharness/parts and its transitive
 *    deps like better-sqlite3) are auto-included by electron-builder's
 *    production-dependency resolver, regardless of the `files` allowlist. The
 *    `files` entries below are explicit for clarity, but they are redundant
 *    with that auto-resolution. The allowlist keeps the config readable and
 *    documents the intent: the packaged app includes the renderer bundle
 *    (Vite output), the main process, and production dependencies.
 *
 * 3. Native modules (better-sqlite3) must be rebuilt against Electron's Node
 *    ABI before packaging, but NOT via electron-builder's own `npmRebuild`
 *    option. That option runs its own scoped "install production
 *    dependencies" pass for this package (packages/app) before packaging --
 *    in this npm-workspaces layout that pass prunes hoisted root
 *    node_modules packages electron-builder itself still needs later in the
 *    same run (electron, 7zip-bin), and packaging then fails partway through
 *    with ENOENT. Instead, `npm run package:*` runs
 *    `scripts/rebuild-native.mjs` first, which rebuilds better-sqlite3 in
 *    place via @electron/rebuild without touching anything else in
 *    node_modules. `npmRebuild` is disabled here accordingly.
 *    `asarUnpack` unpacks only compiled binaries outside the asar archive;
 *    the JS and other sources load fine from inside it, keeping the
 *    installer small.
 */

const electronVersion = require('electron/package.json').version;

module.exports = {
  appId: 'dev.openharness.app',
  productName: 'OpenHarness',
  copyright: 'Copyright (c) 2026 OpenHarness contributors',
  electronVersion,

  // This app has no auto-updater wired up, and releases are uploaded to
  // GitHub Releases by a separate CI step (softprops/action-gh-release), not
  // by electron-builder's own publish mechanism. Without this, electron-builder
  // still tries to generate auto-update metadata for AppImage/deb and can
  // crash (`Cannot read properties of null (reading 'channel')`) when it
  // can't resolve a publish target -- disable that machinery outright.
  publish: null,

  directories: {
    output: '../../release',
    buildResources: 'build',
  },

  files: [
    'dist/**/*',
    'dist-electron/**/*',
    'package.json',
    '../../node_modules/better-sqlite3/**/*',
    '../../node_modules/bindings/**/*',
    '../../node_modules/file-uri-to-path/**/*',
    '../../packages/parts/dist/**/*',
    '../../packages/parts/package.json',
  ],

  asarUnpack: [
    '**/*.node',
  ],

  // Native modules are rebuilt ahead of time by scripts/rebuild-native.mjs
  // (see the file header above for why electron-builder's own npmRebuild
  // step can't be used in this workspace layout).
  npmRebuild: false,

  fileAssociations: [
    {
      ext: 'ohd',
      name: 'OpenHarness document',
      description: 'OpenHarness harness document',
      role: 'Editor',
    },
  ],

  win: {
    icon: 'build/icon.ico',
    sign: null,
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] },
    ],
  },

  nsis: {
    // A normal installer with a visible directory choice, not a silent
    // one-click that drops the app into AppData without asking.
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'OpenHarness',
    artifactName: 'OpenHarness-Setup-${version}-${arch}.${ext}',
  },

  portable: {
    // Single .exe, no install, no admin rights, no registry writes. This is
    // the one to use on a locked-down machine.
    artifactName: 'OpenHarness-${version}-portable-${arch}.${ext}',
  },

  linux: {
    icon: 'build/icon.png',
    category: 'Development',
    synopsis: 'Local-first wire harness CAD',
    target: ['AppImage', 'deb'],
    artifactName: 'OpenHarness-${version}-${arch}.${ext}',
  },

  mac: {
    icon: 'build/icon.png',
    category: 'public.app-category.developer-tools',
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
    artifactName: 'OpenHarness-${version}-${arch}.${ext}',
  },
};