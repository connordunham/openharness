# Security policy

## Reporting a vulnerability

Please report security issues privately, not as a public issue.

Use GitHub's [private vulnerability
reporting](https://github.com/connordunham/openharness/security/advisories/new)
on this repository. If that is unavailable to you, open an issue that says
only that you have a security report and asks for a contact — no details.

Please include what you can: what an attacker can do, how to reproduce it, and
which version or commit you tested.

This is a small project. Expect a first response within about a week, and
please assume good faith about the delay rather than the silence meaning it
was ignored. We will tell you what we intend to do and roughly when, and credit
you in the fix unless you would rather we didn't.

## What is in scope

OpenHarness is a **local desktop application**. There is no server, no
account, and no network service belonging to this project, so the threat model
is narrower than it would be for a hosted tool. What we care about:

- **Opening a malicious document.** `.ohd` files and imported vendor JSON come
  from outside and may be shared between people. Anything that turns opening a
  file into code execution, arbitrary file access or a crash-on-open is in
  scope and is the highest-severity class here.
- **Electron sandbox and IPC.** Renderer-to-main boundary escapes,
  `contextBridge` surface that exposes more than it should, and anything that
  lets renderer content reach the filesystem outside a user-chosen path.
- **The automation surface.** Scripts and the MCP server run with the user's
  privileges by design — that is the product. In scope is anything that lets a
  *document* cause automation to run without the user choosing to run it.
- **Supply chain.** A dependency advisory that actually reaches shipped code.
  We know Electron 31 carries an ASAR integrity bypass advisory and is behind;
  it is tracked and does not need a new report.

## What is out of scope

- Automation scripts the user deliberately runs doing whatever the user told
  them to. That is not a vulnerability, that is the feature.
- Reports that the application can read and write files the user selected.
- Design-rule checks being wrong or missing. That matters a great deal, but it
  is an engineering-correctness issue — open a normal issue, or a Domain
  question. See `docs/DOMAIN-DECISIONS.md`.
- Findings from an automated scanner with no demonstrated path to impact.

## Supported versions

Pre-1.0. Only the current `main` is supported. There are no backports.

## A word about what this tool does not guarantee

OpenHarness produces documentation for things that get built and energised.
The design-rule checks are an aid, not an assurance: some are validated
against a standard, some are recorded engineering decisions, and some are
explicitly unvalidated. MIT disclaims warranty and that is legally real, but
the practical statement matters more — **nothing this tool outputs replaces
engineering review.** Check the harness, not just the green tick.
