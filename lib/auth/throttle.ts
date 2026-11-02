const LIMIT = 5;
const WINDOW_MS = 10 * 60 * 1000;

// Counts failed logins per username in memory. After five failures in ten minutes the
// username is blocked until the oldest of them is ten minutes old. The count lives in
// this server process, so it resets on restart; that is enough to slow down guessing.
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  private recent(key: string, now: number): number[] {
    const kept = (this.failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (kept.length > 0) this.failures.set(key, kept);
    else this.failures.delete(key);
    return kept;
  }

  isBlocked(key: string, now: number = Date.now()): boolean {
    return this.recent(key, now).length >= LIMIT;
  }

  fail(key: string, now: number = Date.now()): void {
    this.failures.set(key, [...this.recent(key, now), now]);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}

export const loginThrottle = new LoginThrottle();
