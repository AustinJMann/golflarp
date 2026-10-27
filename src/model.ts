import {
  clamp,
  DEFAULT_SETTINGS,
  ZERO_TO_25_MPS,
  type EngineFrame,
  type SoundPack,
} from "./types";

/** Five gear redline speeds, expressed as a fraction of the cart's configured top speed. */
const GEARS = [0.25, 0.43, 0.63, 0.83, 1];
export class EngineModel {
  private gear = 1;
  private rpm = 950;
  private boost = 0;
  private lastShift = -Infinity;
  private lastBlowoff = -Infinity;
  private throttle = 0;
  reset() {
    this.gear = 1;
    this.rpm = 950;
    this.boost = 0;
    this.lastShift = -Infinity;
    this.lastBlowoff = -Infinity;
    this.throttle = 0;
  }
  step(
    speed: number | null,
    acceleration: number,
    topSpeed: number,
    engine: SoundPack["engine"],
    now: number,
    dt: number,
    manualThrottle?: number,
    zeroTo25Seconds = DEFAULT_SETTINGS.zeroTo25Seconds,
  ): EngineFrame {
    const events: EngineFrame["events"] = [];
    const fraction = Math.max(0, speed ?? 0) / Math.max(1, topSpeed);
    const fullAcceleration =
      ZERO_TO_25_MPS /
      clamp(
        Number.isFinite(zeroTo25Seconds)
          ? zeroTo25Seconds
          : DEFAULT_SETTINGS.zeroTo25Seconds,
        1,
        120,
      );
    // Average full-throttle acceleration is the 0–25 speed change / elapsed time.
    // Keep a small steady-speed load; deceleration reduces it to zero.
    const targetThrottle =
      speed === null
        ? 0
        : (manualThrottle ??
          (speed < 0.3
            ? 0
            : clamp(0.18 + (0.82 * acceleration) / fullAcceleration, 0, 1)));
    const previousThrottle = this.throttle;
    this.throttle +=
      (targetThrottle - this.throttle) * (1 - Math.exp(-dt / 0.12));
    if (speed !== null && now - this.lastShift > 900) {
      if (this.gear < 5 && fraction > GEARS[this.gear - 1] * 0.91) {
        this.gear++;
        this.lastShift = now;
        events.push("upshift");
      } else if (this.gear > 1 && fraction < GEARS[this.gear - 2] * 0.72) {
        this.gear--;
        this.lastShift = now;
        events.push("downshift");
      }
    }
    if (fraction < 0.015) this.gear = 1;
    const targetRpm =
      speed === null
        ? engine.idleRpm
        : clamp(
            engine.idleRpm +
              (fraction / GEARS[this.gear - 1]) *
                (engine.redlineRpm - engine.idleRpm),
            engine.idleRpm,
            engine.redlineRpm,
          );
    this.rpm +=
      (targetRpm - this.rpm) *
      (1 - Math.exp(-dt / (events.length ? 0.045 : 0.16)));
    const targetBoost = engine.turbo
      ? this.throttle * clamp((this.rpm - 1800) / 3500, 0, 1)
      : 0;
    const discharge =
      this.boost > 0.2 &&
      ((previousThrottle > this.throttle && targetThrottle < 0.1) ||
        events.includes("upshift"));
    if (
      engine.turbo &&
      discharge &&
      now - this.lastBlowoff > 1100 &&
      speed !== null
    ) {
      events.push("blowoff");
      this.lastBlowoff = now;
      this.boost *= 0.2;
    }
    this.boost += (targetBoost - this.boost) * (1 - Math.exp(-dt / 0.6));
    return {
      rpm: this.rpm,
      gear: this.gear,
      throttle: this.throttle,
      boost: this.boost,
      events,
      shifting: now - this.lastShift < 140,
    };
  }
}
