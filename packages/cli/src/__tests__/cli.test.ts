import { describe, it, expect, vi, afterEach } from 'vitest';
import { main } from '../cli.js';

describe('main() dispatch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints help and returns 0 for --help', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main(['--help'])).toBe(0);
    expect(log).toHaveBeenCalled();
  });

  it('prints help and returns 0 when no command is given', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main([])).toBe(0);
    expect(log).toHaveBeenCalled();
  });

  it('returns 1 for an unknown command', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['frobnicate'])).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown command'));
  });

  it('returns 1 for a known-but-unimplemented command', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['run'])).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('not implemented yet'));
  });

  it('returns 1 when a command that needs a file path gets none', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['validate'])).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('requires a file path'));
  });
});
