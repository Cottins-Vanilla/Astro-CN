function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Cancellable cubic-ease interpolation between two layouts, writing into the
 * shared positions buffer over ~900ms. A switch mid-flight calls `start`
 * again with the *current interpolated state* as the new "from" (the caller
 * always passes the live positions buffer), so there is never a jump — see
 * docs/CONSTELLATION.md. The camera is never touched here.
 */
export class LayoutTransition {
  private from: Float32Array;
  private to: Float32Array;
  private startTime = 0;
  private active = false;
  /** The duration in effect for the current run — `durationMs` by default, or `start()`'s
   * per-call override (used for the slower initial-load entrance reveal — see GraphView3D.tsx). */
  private activeDurationMs: number;

  constructor(
    size: number,
    private readonly durationMs = 900,
  ) {
    this.from = new Float32Array(size);
    this.to = new Float32Array(size);
    this.activeDurationMs = durationMs;
  }

  /** Reallocates the pooled buffers — call only when the topology's node count changes. */
  resize(size: number): void {
    if (this.from.length === size) return;
    this.from = new Float32Array(size);
    this.to = new Float32Array(size);
    this.active = false;
  }

  get isActive(): boolean {
    return this.active;
  }

  start(current: Float32Array, target: Float32Array, now: number, durationMs?: number): void {
    this.from.set(current);
    this.to.set(target);
    this.startTime = now;
    this.active = true;
    this.activeDurationMs = durationMs ?? this.durationMs;
  }

  cancel(): void {
    this.active = false;
  }

  /** Writes the interpolated frame into `out`. Returns whether it wrote anything this call. */
  step(now: number, out: Float32Array): boolean {
    if (!this.active) return false;
    const t = this.activeDurationMs <= 0 ? 1 : Math.min(1, (now - this.startTime) / this.activeDurationMs);
    const eased = easeInOutCubic(t);
    for (let i = 0; i < out.length; i++) out[i] = this.from[i] + (this.to[i] - this.from[i]) * eased;
    if (t >= 1) this.active = false;
    return true;
  }
}
