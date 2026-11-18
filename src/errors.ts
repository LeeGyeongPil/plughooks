// Errors that map to the documented exit codes.
// 2 = usage or input problem, 3 = refused for safety.

export class PlugError extends Error {
  readonly exit: 1 | 2 | 3;
  readonly key: string;
  readonly params: Record<string, string | number>;

  constructor(exit: 1 | 2 | 3, key: string, params: Record<string, string | number> = {}) {
    super(key);
    this.exit = exit;
    this.key = key;
    this.params = params;
  }
}
