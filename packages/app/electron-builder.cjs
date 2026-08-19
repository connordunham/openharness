/**
 * Packaging config for the distributable desktop app.
 *
 * The point of this file is that nobody should need Node, npm or a toolchain
 * to run OpenHarness. CI builds installers from a tag and attaches them to a
 * GitHub Release; a user downloads one file and double-clicks it.
 *
 * Two things here are not obvious, and both are consequences of this being an
 * npm workspace rather than a standalone app:
 *
 * 1. `electronVersion` is resolved at runtime rather than written down. npm
 *    hoists `electron` to the *root* node_modules, but electron-builder looks
 *    for it under the app package and gives up with "Cannot compute electron
 *    version from installed node modules". Resolving it through require()
 *    finds the hoisted copy and keeps this file from drifting out of step with
 *    the devDependency — which is why this is a .cjs config and not the
 *    friendlier .yml.
 *
 * 2. `files` is a deliberate allowlist. The main process imports nothing but
 *    `electron` and node builtins, and every workspace library
 *    (@openharness/core, io, render) is bundled into the renderer by Vite, so
 *    the packaged app needs exactly three things and no node_modules at all.
 *    That keeps the installer small and sidesteps electron-builder trying to
 *    follow symlinked workspace dependencies.
 */

const electronVersion = require('electron/package.json').version;

module.exports = {
  appId: 'dev.openharness.app',
  productName: 'OpenHarness',
  copyright: 'Copyright (c) 2026 OpenHarness contributors',
  electronVersion,

  directories: {
    output: '../../release',
    buildResources: 'build',
  },

  files: ['dist/**/*', 'dist-electron/**/*', 'package.json'],

  // No native modules anywhere in the tree, so there is nothing to rebuild.
  npmRebuild: false,
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,

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
