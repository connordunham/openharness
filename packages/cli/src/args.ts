/**
 * Minimal, dependency-free flag parser. Supports `--flag value`,
 * `--flag=value`, and boolean `--flag`. Deliberately not a real CLI
 * framework (no subcommand trees, no validation DSL) — the command set is
 * tiny (spec §8.6) and a hand-rolled ~20 lines keeps the dependency graph
 * boring, matching the stack philosophy in spec §5.2.
 */

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    // Supports both --long-flag and -x short flags (e.g. `-o out.ohd`).
    const prefixLength = arg.startsWith('--') ? 2 : arg.startsWith('-') && arg.length > 1 ? 1 : 0;
    if (prefixLength > 0) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(prefixLength, eq)] = arg.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          flags[arg.slice(prefixLength)] = next;
          i += 1;
        } else {
          flags[arg.slice(prefixLength)] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

export function requireFlag(flags: ParsedArgs['flags'], name: string): string {
  const value = flags[name];
  if (typeof value !== 'string') {
    throw new Error(`Missing required flag --${name}`);
  }
  return value;
}

export function stringFlag(flags: ParsedArgs['flags'], name: string, fallback?: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : fallback;
}
