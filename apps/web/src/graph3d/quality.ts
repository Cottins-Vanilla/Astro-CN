export type QualityTier = "high" | "mid" | "low";

export interface QualitySettings {
  dprCap: number;
  labelCount: number;
  twinkle: boolean;
  edgeGlow: boolean;
}

/** Exact table from docs/CONSTELLATION.md's "Adaptive quality" section. */
const TIERS: Record<QualityTier, QualitySettings> = {
  high: { dprCap: 2, labelCount: 40, twinkle: true, edgeGlow: true },
  mid: { dprCap: 1.5, labelCount: 24, twinkle: true, edgeGlow: false },
  low: { dprCap: 1, labelCount: 12, twinkle: false, edgeGlow: false },
};

/** Frame-time (ms) above which a tier is considered too slow to hold. */
const DOWNGRADE_MS: Record<QualityTier, number> = { high: 24, mid: 34, low: Number.POSITIVE_INFINITY };
/** Frame-time (ms) below which a tier is comfortably fast enough to step up. */
const UPGRADE_MS: Record<QualityTier, number> = { high: Number.NEGATIVE_INFINITY, mid: 17, low: 26 };
/** Consecutive out-of-band frames required before switching — avoids flapping on a single stutter. */
const HOLD_FRAMES = 45;

/**
 * A frame-time EMA driving High/Mid/Low quality with hysteresis, per
 * docs/CONSTELLATION.md. Cheap and allocation-free: `update` is called once
 * per animation frame.
 */
export class AdaptiveQuality {
  private ema = 16;
  private tier: QualityTier = "high";
  private streak = 0;

  update(frameMs: number): QualityTier {
    this.ema = this.ema * 0.9 + frameMs * 0.1;

    if (this.ema > DOWNGRADE_MS[this.tier]) {
      this.streak++;
      if (this.streak > HOLD_FRAMES && this.tier !== "low") {
        this.tier = this.tier === "high" ? "mid" : "low";
        this.streak = 0;
      }
    } else if (this.ema < UPGRADE_MS[this.tier]) {
      this.streak++;
      if (this.streak > HOLD_FRAMES && this.tier !== "high") {
        this.tier = this.tier === "low" ? "mid" : "high";
        this.streak = 0;
      }
    } else {
      this.streak = 0;
    }

    return this.tier;
  }

  get current(): QualityTier {
    return this.tier;
  }

  get settings(): QualitySettings {
    return TIERS[this.tier];
  }
}
