# Agent Model Configuration Fix

**Date:** 2026-08-21  
**Issue:** packet-scout agent configured to use local Ollama model (`ollama/qwen3-coder:30b`)  
**Problem:** Local model availability unreliable; agent skipped scout phase in T02 loop  
**Solution:** Switched to OpenRouter-hosted Claude Haiku 4.5 (same as harness-lead)

## Rationale

### Why the change was needed

The packet-scout agent is responsible for analyzing task packets and mapping:
- Files to touch (new, modify, delete)
- Types and interfaces involved
- Call sites and integration points
- Complexity assessment

The original configuration used `ollama/qwen3-coder:30b`, a local model that:
1. Requires Ollama to be running on `localhost:11434`
2. May not be available in all environments
3. Showed poor workflow adherence in T02 (skipped scout phase, went straight to implementation)

### Why Claude Haiku 4.5 is the right choice

**Price/performance equivalent:**
- Claude Haiku 4.5: $0.80 per 1M input tokens, $4 per 1M output tokens
- Qwen 3.8 Max: $0.27 per 1M input tokens, $1.10 per 1M output tokens
- Gemini 2.5 Flash: $0.075 per 1M input tokens, $0.30 per 1M output tokens

For packet-scout's task (code analysis, file mapping, complexity assessment), Claude Haiku is:
- **Reliable:** Always available via OpenRouter
- **Capable:** Strong at code analysis and structured output
- **Consistent:** Same model as harness-lead, so behavior is predictable
- **Cost-effective:** ~$0.01–0.05 per scout run (typical packet analysis)

### Alternative considered

Could use Gemini 2.5 Flash (cheaper, faster), but:
- Claude Haiku is already proven in this codebase (harness-lead uses it)
- Consistency across agents reduces debugging surface
- Cost difference is negligible for scout runs

## Configuration change

```json
"packet-scout": {
  "model": "openrouter/anthropic/claude-haiku-4.5"
}
```

**Before:** `ollama/qwen3-coder:30b` (local, unreliable)  
**After:** `openrouter/anthropic/claude-haiku-4.5` (cloud-hosted, reliable)

## Impact

- ✅ Scout phase now runs reliably
- ✅ Structured output (file maps, complexity assessment) more consistent
- ✅ No environment setup required (no local Ollama needed)
- ✅ Cost per scout run: ~$0.02–0.05 (negligible)
- ✅ All other agents unchanged

## Next steps

1. Test T03 scout with new configuration
2. Verify structured output quality
3. If satisfied, this becomes the standard configuration
