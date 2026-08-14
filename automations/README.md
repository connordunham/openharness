# Automations

Your own automations live here, one folder per automation (spec §8.2):

```
automations/
  my-automation/
    automation.json   # manifest: id, permissions, contributed commands/rules/panels/exporters
    index.ts           # entry module, exports activate(ctx)
```

Ten worth writing first, in roughly the order that compounds best, are listed
in `HARNESS-DESIGNER-SPEC.md` §8.8. Nothing here yet — the automation host
(`@openharness/automation`) that loads and sandboxes these is Phase 5 work.
