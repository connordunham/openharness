# T23 - CSV formula injection hardening

**Size** S · **Package** `@openharness/io` · **Needs** none · **Source** `docs/SECURITY-AUDIT-2026-08-25.md` Finding 1

## Goal

A CSV cell whose content is attacker-controlled and starts with `=`, `+`, `-`,
or `@` is interpreted as a formula by Excel and LibreOffice, not as text. Every
field in a BOM or interconnect CSV export can originate from an imported vendor
JSON or a hand-crafted `.ohd` file - not just from parts the user typed in
themselves. Today's escaping only guards against `"`, `,`, and newlines, so
nothing stops a crafted `manufacturer` or `description` field from carrying a
formula straight into a spreadsheet the user later opens and trusts.

Concretely: import a vendor JSON with `manufacturer: "=cmd|'/c calc'!A1"`,
export the BOM to CSV, open it in Excel - the formula runs. That is the full
exploit chain, and it is the only finding in the audit reachable end-to-end by
an ordinary user (attacker sends a harness file, victim imports then exports
then opens the result).

## Contract

Both `packages/io/src/bomCsv.ts` and `packages/io/src/interconnectCsv.ts`
export a `csvEscape` that is otherwise correct (RFC 4180 quoting on `"`, `,`,
`\r`, `\n`) but does not defend against formula injection. Fix both, the same
way, so they do not drift again:

A cell is **force-quoted** (wrapped in `"..."`, with internal `"` doubled, same
as today's quoting) if, after any leading whitespace, its first character is
`=`, `+`, `-`, or `@`. This applies whether or not the cell also needs quoting
for RFC 4180 reasons - the two triggers are independent and either one alone
is enough to quote.

Quoting alone is not sufficient in every spreadsheet application (some still
evaluate a quoted leading `=` in certain configurations) - after quoting for
the reasons above, additionally prefix the cell's content with a single tab
character (`\t`) before the closing behavior of the existing quote logic, OR
prefix with a leading `'` per the common CSV-injection mitigation, whichever
you land on - **pick one, document why in a comment at `csvEscape`, and apply
it identically in both files.** Do not invent a third approach per file.

Do not change the escaping for any cell that does not start with one of those
four characters - existing golden-file / snapshot expectations in
`bomCsv.test.ts` for ordinary data must still pass unchanged.

## Acceptance tests

- a cell exactly `=cmd|'/c calc'!A1` is force-quoted/neutralized on export
- cells starting with `+`, `-`, and `@` are each force-quoted/neutralized
- a cell starting with whitespace then `=` (e.g. `"  =1+1"`) is still caught
- a cell containing `=` in the *middle* (e.g. `"Molex 43025=4"`) is **not**
  force-quoted for that reason alone - only a *leading* trigger character
  matters, per the audit's fix direction. (It may still be quoted for the
  existing RFC 4180 reasons if it also contains a comma/quote/newline.)
- the fix is applied to both `bomCsv.ts` and `interconnectCsv.ts`; each gets
  its own test (there is currently no `interconnectCsv.test.ts` - add one,
  it does not exist yet)
- every field that can carry attacker-controlled content is covered by at
  least one test: `partNumber`, `manufacturer`, `vendorPartNumber`,
  `description`, `url`, a `parameters` entry, and `refdes`/signal fields in
  the interconnect export
- a normal, non-attacking export (existing fixtures) is byte-for-byte
  unchanged except where a cell now legitimately starts with a trigger
  character

## Traps

- **Don't just check for a *bare* `=`.** `+`, `-`, and `@` are also live
  formula triggers in at least one of Excel/LibreOffice/Google Sheets. All
  four or the fix is incomplete.
- **Don't quote on `=` appearing anywhere in the string.** Legitimate data
  (a part number, a note) can contain `=` mid-string; over-triggering breaks
  real exports for no security benefit. Only a *leading* trigger character
  (after stripping leading whitespace) counts.
- **Keep both files' `csvEscape` identical.** They are separate functions
  today by copy-paste, not by design difference; a fix landed in one and not
  the other reopens the same hole in the file nobody touched.
- This is escaping/output-encoding, not input validation - do not reject or
  strip the data at import time. The value must still round-trip correctly
  through `.ohd` and through re-import; only its CSV *serialization* changes.