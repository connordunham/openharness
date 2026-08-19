---
name: Domain question
about: A wire-harness engineering question about what the tool asserts
title: ''
labels: domain
---

These are welcome and genuinely useful. The project has a resident harness
engineer, and most of these are settled in one line and recorded permanently
in `docs/DOMAIN-DECISIONS.md`.

**What does the tool currently assert?**

The rule, the limit, or the behaviour — in engineering terms rather than code
terms, if you can.

**What do you think is wrong about it?**

**What design does it wrongly pass, or wrongly fail?**

A concrete harness is worth more here than a general argument.

**Is there a published basis?**

IPC/WHMA-A-620, SAE, a manufacturer's crimp or connector spec, anything. If
you have one, quote the relevant part — that usually settles it immediately.
If you don't, say so; "this is how it is done where I work" is legitimate
evidence and we will label it as such rather than dressing it up as a standard.

**Where is it in the code?**, if you happened to find it

Design rules live in `packages/core/src/derive/rules.ts`; settled decisions
are in `docs/DOMAIN-DECISIONS.md`.
