import { afterEach, describe, expect, it, vi } from "vitest";
import { SensorService, SpeedFilter, SpeedFusion } from "./sensors";
const coords = (
  speed: number | null,
  accuracy = 5,
  latitude = 40,
): GeolocationCoordinates => ({
  latitude,
  longitude: -74,
  altitude: null,
  altitudeAccuracy: null,
  heading: null,
  accuracy,
  speed,
  toJSON() {
    return this;
  },
});
describe("GPS speed quality", () => {
  it("treats a measured zero as valid and rejects poor accuracy and impossible jumps", () => {
    const filter = new SpeedFilter();
    expect(filter.update(coords(0), 1000)).toBe(true);
    expect(filter.speed).toBe(0);
    expect(filter.update(coords(25), 2000)).toBe(false);
    expect(filter.update(coords(1, 100), 3000)).toBe(false);
    expect(filter.lastGood).toBe(1000);
  });
  it("marks speed stale after three seconds", () => {
    const filter = new SpeedFilter();
    filter.update(coords(3), 1000);
    expect(filter.fresh(4000)).toBe(true);
    expect(filter.fresh(4001)).toBe(false);
  });
  it("anchors a measured stop at zero without a smoothing tail", () => {
    const filter = new SpeedFilter();
    filter.update(coords(2), 1000);
    filter.update(coords(0), 2000);
    expect(filter.speed).toBe(0);
  });
  it("uses position differences when reported speed is null", () => {
    const filter = new SpeedFilter();
    expect(filter.update(coords(null, 2, 40), 1000)).toBe(false);
    expect(filter.update(coords(null, 2, 40.00009), 3000)).toBe(true);
    expect(filter.source).toBe("position");
    expect(filter.speed).toBeGreaterThan(4);
    expect(filter.speed).toBeLessThan(6);
  });
  it("does not turn stationary GPS jitter into speed", () => {
    const filter = new SpeedFilter();
    filter.update(coords(null, 10, 40), 1000);
    filter.update(coords(null, 10, 40.00001), 3000);
    expect(filter.speed).toBe(0);
  });
  it("detects slow movement across frequent position-only fixes", () => {
    const filter = new SpeedFilter();
    // At 2 m/s, each one-second displacement is below the 5 m uncertainty.
    for (let seconds = 0; seconds <= 12; seconds++)
      filter.update(
        coords(null, 5, 40 + (seconds * 2) / 111195),
        seconds * 1000,
      );
    expect(filter.source).toBe("position");
    expect(filter.speed).toBeGreaterThan(1.8);
    expect(filter.speed).toBeLessThan(2.2);
    // Once the rolling window contains only stopped fixes, return to zero.
    for (let seconds = 13; seconds <= 22; seconds++)
      filter.update(coords(null, 5, 40 + 24 / 111195), seconds * 1000);
    expect(filter.speed).toBeLessThan(0.1);
  });
  it("discards long-gap position estimates and rejects out-of-order updates", () => {
    const filter = new SpeedFilter();
    filter.update(coords(null, 2), 1000);
    expect(filter.update(coords(null, 2, 41), 12000)).toBe(false);
    filter.update(coords(2), 13000);
    expect(filter.update(coords(3), 12000)).toBe(false);
  });
});

describe("speed fusion", () => {
  it("responds to acceleration and braking before another GPS fix", () => {
    const fusion = new SpeedFusion();
    fusion.correct(3, 0);
    for (let now = 20; now <= 1000; now += 20) fusion.advance(1, now);
    expect(fusion.read(1000)).toBeCloseTo(4, 6);
    for (let now = 1020; now <= 2000; now += 20) fusion.advance(-1, now);
    expect(fusion.read(2000)).toBeCloseTo(3, 6);
  });
  it("corrects motion drift with each GPS fix and pins measured stops to zero", () => {
    const fusion = new SpeedFusion();
    fusion.correct(3, 0);
    for (let now = 20; now <= 1000; now += 20) fusion.advance(1, now);
    fusion.correct(3, 1000);
    expect(fusion.read(1000)).toBeCloseTo(3.35, 6);
    fusion.correct(0, 2000);
    expect(fusion.read(2000)).toBe(0);
    for (let now = 2020; now <= 2500; now += 20) fusion.advance(-2, now);
    expect(fusion.read(2500)).toBe(0);
  });
  it("bounds prediction error and ignores small residual vibration", () => {
    const fusion = new SpeedFusion();
    fusion.correct(2, 0);
    for (let now = 20; now <= 500; now += 20) fusion.advance(0.05, now);
    expect(fusion.read(500)).toBe(2);
    for (let now = 520; now <= 2500; now += 20) fusion.advance(4, now);
    expect(fusion.read(2500)).toBe(4);
  });
  it("requires a GPS reference and expires even with continuing motion events", () => {
    const fusion = new SpeedFusion();
    fusion.advance(1, 0);
    expect(fusion.read(0)).toBeNull();
    fusion.correct(2, 0);
    for (let now = 20; now <= 4000; now += 20) fusion.advance(1, now);
    expect(fusion.read(4000)).toBeNull();
    fusion.correct(5, 4000);
    expect(fusion.read(4000)).toBe(5);
  });
  it("does not integrate missing motion events or reuse a reset prediction", () => {
    const fusion = new SpeedFusion();
    fusion.correct(2, 0);
    fusion.advance(2, 100);
    expect(fusion.read(100)).toBeCloseTo(2.2);
    expect(fusion.read(700)).toBeNull();
    fusion.advance(2, 1000);
    expect(fusion.read(1000)).toBe(2);
    fusion.reset();
    fusion.advance(2, 1100);
    expect(fusion.read(1100)).toBeNull();
    fusion.correct(3, 1200);
    expect(fusion.read(1200)).toBe(3);
  });
});

describe("mounted motion calibration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("learns the forward axis, detects a repositioned phone, and releases GPS", () => {
    let now = 0;
    let gps: PositionCallback = () => undefined;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const target = new EventTarget() as EventTarget & {
      isSecureContext: boolean;
    };
    target.isSecureContext = true;
    const clear = vi.fn();
    vi.stubGlobal("window", target);
    vi.stubGlobal("navigator", {
      geolocation: {
        watchPosition(callback: PositionCallback) {
          gps = callback;
          return 9;
        },
        clearWatch: clear,
      },
    });
    const service = new SensorService();
    service.start(true);
    const motion = (x: number, gravity = { x: 0, y: 0, z: 9.81 }) => {
      const e = new Event("devicemotion");
      Object.assign(e, {
        acceleration: { x, y: 0, z: 0 },
        accelerationIncludingGravity: gravity,
        rotationRate: { alpha: 0, beta: 0, gamma: 0 },
      });
      target.dispatchEvent(e);
    };
    for (let i = 0; i <= 60; i++) {
      now = i * 50;
      motion(0);
    }
    expect(service.read(now).calibration).toBe("learning");
    const push = (speed: number) =>
      gps({
        coords: coords(speed),
        timestamp: Date.now(),
      } as GeolocationPosition);
    push(0);
    now += 1000;
    push(1);
    for (let i = 0; i < 40; i++) {
      now += 25;
      motion(0.8);
    }
    expect(service.read(now).calibration).toBe("ready");
    expect(service.read(now).acceleration).toBeGreaterThan(0.2);
    // No new GPS fix: the calibrated accelerometer drives speed and RPM.
    const before = service.read(now).speed!;
    for (let i = 0; i < 20; i++) {
      now += 25;
      motion(0.8);
    }
    expect(service.read(now).speed!).toBeGreaterThan(before + 0.3);
    // Moving the mount immediately falls back to the last measured GPS speed.
    motion(0, { x: 0, y: 9.81, z: 0 });
    expect(service.read(now).calibration).toBe("moved");
    expect(service.read(now).speed!).toBeLessThan(before);
    now += 3001;
    expect(service.read(now).speed).toBeNull();
    service.stop();
    expect(clear).toHaveBeenCalledWith(9);
    vi.unstubAllGlobals();
  });
});
