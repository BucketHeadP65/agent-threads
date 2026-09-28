/**
 * Polls a single "active" path's version signal on a fixed interval and
 * calls `onChanged` when it moves from one value to a different one.
 * Exists because Obsidian's vault "modify" event never fires under a
 * hidden folder (see `vault-notes.ts`'s `sidecarMtime`), so an external
 * writer's change to a thread file has no other live signal while the owner
 * has the file open.
 *
 * The first read after `setActivePath` only establishes a baseline. It
 * never calls `onChanged`, since callers already load fresh state at the
 * moment a path becomes active. Retargeting to a different path (or to
 * `null`) discards that baseline and stops the timer until a path is
 * active again.
 */
export class SidecarPoller {
  private activePath: string | null = null;
  private baseline: number | null = null;
  private hasBaseline = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly readVersion: (path: string) => Promise<number | null>,
    private readonly onChanged: (path: string) => void,
    private readonly intervalMs: number,
  ) {}

  /** Retargets the poll to `path`, or stops it for `null`. A no-op if `path` is already the active one. */
  setActivePath(path: string | null): void {
    if (path === this.activePath) return;
    this.activePath = path;
    this.hasBaseline = false;
    this.baseline = null;
    this.stopTimer();
    if (path !== null) this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  /** Stops polling for good. */
  destroy(): void {
    this.stopTimer();
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    const path = this.activePath;
    if (path === null) return;
    const version = await this.readVersion(path);
    if (path !== this.activePath) return; // retargeted while the read was in flight

    if (!this.hasBaseline) {
      this.hasBaseline = true;
      this.baseline = version;
      return;
    }
    if (version !== this.baseline) {
      this.baseline = version;
      this.onChanged(path);
    }
  }
}
