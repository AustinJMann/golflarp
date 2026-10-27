import { describe, expect, it } from "vitest";
import { EngineModel } from "./model";
import { DEFAULT_PACK } from "./packs";
import { DEFAULT_SETTINGS, ZERO_TO_25_MPS, type EngineFrame } from "./types";

const engine = DEFAULT_PACK.engine;
function simulate(
  topSpeed: number,
  seconds: number,
  speed: (t: number) => number | null,
  acceleration = 0,
  throttle?: number,
) {
  const model = new EngineModel();
  const frames: EngineFrame[] = [];
  for (let t = 0; t < seconds; t += 0.05)
    frames.push(
      model.step(
        speed(t),
        acceleration,
        topSpeed,
        engine,
        t * 1000,
        0.05,
        throttle,
      ),
    );
  return frames;
}
describe("virtual engine", () => {
  it("uses the user's 0–25 time to estimate throttle from acceleration", () => {
    const estimate = (
      seconds: number,
      acceleration: number,
      speed: number | null = 5,
    ) => {
      const model = new EngineModel();
      let frame!: EngineFrame;
      for (let t = 0; t < 5; t += 0.05)
        frame = model.step(
          speed,
          acceleration,
          12,
          engine,
          t * 1000,
          0.05,
          undefined,
          seconds,
        );
      return frame.throttle;
    };
    expect(estimate(10, ZERO_TO_25_MPS / 10)).toBeCloseTo(1, 3);
    expect(estimate(20, ZERO_TO_25_MPS / 20)).toBeCloseTo(1, 3);
    expect(estimate(20, 0.4)).toBeGreaterThan(estimate(5, 0.4));
    expect(estimate(10, 0.8)).toBeGreaterThan(estimate(10, 0.2));
    expect(estimate(10, -1)).toBeCloseTo(0, 3);
    expect(estimate(10, 1, 0)).toBeCloseTo(0, 3);
    expect(estimate(10, 1, null)).toBeCloseTo(0, 3);
  });
  it("keeps pitch and gear stable as demo throttle changes at a fixed speed", () => {
    const coast = simulate(12, 8, () => 8, 0, 0).at(-1)!;
    const loaded = simulate(12, 8, () => 8, 0, 1).at(-1)!;
    expect(loaded.rpm).toBeCloseTo(coast.rpm, 6);
    expect(loaded.gear).toBe(coast.gear);
    expect(loaded.throttle).toBeGreaterThan(coast.throttle);
    expect(loaded.boost).toBeGreaterThan(coast.boost);
    const stopped = simulate(12, 8, () => 0, 0, 1).at(-1)!;
    expect(stopped.rpm).toBeCloseTo(engine.idleRpm, 0);
  });
  it("runs through five gears in a 25 mph cart and drops RPM on shifts", () => {
    const frames = simulate(
      DEFAULT_SETTINGS.topSpeedMps,
      20,
      (t) => Math.min(DEFAULT_SETTINGS.topSpeedMps, t * 0.7),
      0.7,
    );
    expect(new Set(frames.map((f) => f.gear))).toEqual(
      new Set([1, 2, 3, 4, 5]),
    );
    const shifts = frames
      .map((frame, i) => ({ frame, i }))
      .filter((f) => f.frame.events.includes("upshift"));
    expect(shifts).toHaveLength(4);
    for (const { frame, i } of shifts)
      expect(frame.rpm).toBeLessThan(frames[i - 1].rpm);
  });
  it("scales gearing to top speed and never exceeds redline", () => {
    const slow = simulate(5, 8, () => 4.8).at(-1)!;
    const fast = simulate(20, 8, () => 4.8).at(-1)!;
    expect(slow.gear).toBeGreaterThan(fast.gear);
    const overspeed = simulate(5, 8, () => 25);
    expect(overspeed.every((f) => f.rpm <= engine.redlineRpm)).toBe(true);
  });
  it("does not hunt gears around an upshift boundary", () => {
    const frames = simulate(10, 15, (t) => 2.3 + Math.sin(t * 12) * 0.05);
    expect(frames.filter((f) => f.events.includes("downshift"))).toHaveLength(
      0,
    );
    expect(
      frames.filter((f) => f.events.includes("upshift")).length,
    ).toBeLessThanOrEqual(1);
  });
  it("returns to idle and suppresses discharge events when GPS is lost", () => {
    const frames = simulate(12, 12, (t) => (t < 6 ? 8 : null), 1);
    const last = frames.at(-1)!;
    expect(last.gear).toBe(1);
    expect(last.rpm).toBeCloseTo(engine.idleRpm, 0);
    expect(frames.slice(121).flatMap((f) => f.events)).toEqual([]);
  });
  it("bounds turbo discharge frequency during noisy acceleration", () => {
    const model = new EngineModel();
    const times: number[] = [];
    for (let t = 0; t < 20; t += 0.05) {
      const frame = model.step(
        8,
        Math.sin(t * 6) * 2,
        12,
        engine,
        t * 1000,
        0.05,
      );
      if (frame.events.includes("blowoff")) times.push(t);
    }
    expect(times.length).toBeGreaterThan(0);
    times
      .slice(1)
      .forEach((t, i) => expect(t - times[i]).toBeGreaterThanOrEqual(1.09));
  });
});
