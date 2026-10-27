import { afterEach, describe, expect, it, vi } from "vitest";
import { SensorService, SpeedFilter } from "./sensors";
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
  it("discards long-gap position estimates and rejects out-of-order updates", () => {
    const filter = new SpeedFilter();
    filter.update(coords(null, 2), 1000);
    expect(filter.update(coords(null, 2, 41), 12000)).toBe(false);
    filter.update(coords(2), 13000);
    expect(filter.update(coords(3), 12000)).toBe(false);
  });
});

describe("mounted motion calibration", () => {
  afterEach(() => vi.restoreAllMocks());
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
    motion(0, { x: 0, y: 9.81, z: 0 });
    expect(service.read(now).calibration).toBe("moved");
    service.stop();
    expect(clear).toHaveBeenCalledWith(9);
    vi.unstubAllGlobals();
  });
});
