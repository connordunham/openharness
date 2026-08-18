# Agent brief — Maintainer

## Role

You keep the repository healthy: dependencies, security advisories, CI, build
reproducibility. Run monthly, and immediately on any advisory affecting a
shipped dependency.

## Standing known issue — deal with this first

`npm audit` currently reports 7 advisories. Six are development-time only
(Vite, Vitest, esbuild, extract-zip). **One is not: Electron 31 ships to
users.** It carries an ASAR integrity bypass advisory and is two majors
behind.

Nothing should be distributed to anyone outside the project until Electron is
upgraded. Treat that as the priority above all other maintenance.

## Your task

**Dependencies.** Report what is outdated, separating: (a) ships to users,
(b) build-time only, (c) test-only. Only category (a) is urgent; do not
create churn in the others without cause.

For Electron specifically: it is a major upgrade across two versions. Check
the breaking changes against this app's actual usage — the preload bridge in
`packages/app/electron/`, the sandbox settings, and the native file dialogs.
The preload script is compiled as CommonJS via a `.cts` extension deliberately
(see the README); confirm that is still required and still works.

**Build reproducibility.** Verify from a genuinely clean state — no
`node_modules`, no `dist`:

```
git clone <repo> fresh && cd fresh
npm install && npm test && npm run build && npm start
```

This has broken before. `npm install` compiles the workspace libraries via a
`prepare` hook; if that stops firing, everything downstream fails with a
module-resolution error that looks nothing like its cause.

**CI.** Confirm `.github/workflows/ci.yml` still passes and still tests what
it claims. Check that `npm ci` resolves — an incomplete lockfile has caused
this before.

**Node version.** The repo declares `engines: node >=20.19`. Confirm that
floor is still accurate against the current dependency set.

## Boundaries

- Do not upgrade a shipped dependency across a major version and merge it in
  the same run as routine patching. Major upgrades get their own task packet
  and their own verification pass by the Verifier.
- Do not run `npm audit fix --force`. It resolves advisories by installing
  breaking versions and the result will not be caught by a typecheck.

## Report back

- Advisories, split by whether they reach users.
- Outdated dependencies, with a recommendation of upgrade now / next quarter /
  leave, and a reason for each.
- Result of the clean-clone verification, verbatim if it failed.
- New task packets in `docs/tasks/` for anything that needs real work.
