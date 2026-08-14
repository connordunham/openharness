import { describe, it, expect } from 'vitest';
import { parseArgs, requireFlag, stringFlag } from '../args.js';

describe('parseArgs', () => {
  it('separates positional arguments from flags', () => {
    const { positional, flags } = parseArgs(['file.ohd', '--format', 'json']);
    expect(positional).toEqual(['file.ohd']);
    expect(flags.format).toBe('json');
  });

  it('supports --flag=value syntax', () => {
    expect(parseArgs(['--fail-on=error']).flags['fail-on']).toBe('error');
  });

  it('treats a trailing flag with no value as boolean true', () => {
    expect(parseArgs(['--verbose']).flags.verbose).toBe(true);
  });

  it('does not consume the next token as a value if it looks like another flag', () => {
    const { flags } = parseArgs(['--verbose', '--format', 'json']);
    expect(flags.verbose).toBe(true);
    expect(flags.format).toBe('json');
  });

  it('supports short flags like -o out.ohd', () => {
    const { flags } = parseArgs(['file.json', '-o', 'out.ohd']);
    expect(flags.o).toBe('out.ohd');
  });
});

describe('requireFlag / stringFlag', () => {
  it('requireFlag throws when the flag is missing', () => {
    expect(() => requireFlag({}, 'o')).toThrow(/--o/);
  });

  it('requireFlag returns the value when present', () => {
    expect(requireFlag({ o: 'out.ohd' }, 'o')).toBe('out.ohd');
  });

  it('stringFlag returns the fallback when absent', () => {
    expect(stringFlag({}, 'format', 'text')).toBe('text');
  });
});
