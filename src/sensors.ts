import { clamp, type Telemetry } from "./types";

type Vector = [number, number, number];
const norm = (v: Vector) => Math.hypot(...v);
const dot = (a: Vector, b: Vector) => a.reduce((s, v, i) => s + v * b[i], 0);
const vector = (a: DeviceMotionEventAcceleration | null): Vector | null =>
  a && [a.x, a.y, a.z].every((v) => v !== null && Number.isFinite(v))
    ? [a.x!, a.y!, a.z!]
    : null;
export const distance = (
  a: GeolocationCoordinates,
  b: GeolocationCoordinates,
) => {
  const rad = Math.PI / 180;
  const p =
    Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(clamp(p, 0, 1)));
};

export class SpeedFilter {
  speed: number | null = null;
  acceleration = 0;
  accuracy: number | null = null;
  source: Telemetry["source"] = "none";
  lastGood = -Infinity;
  private previous?: { coords: GeolocationCoordinates; now: number };
  update(coords: GeolocationCoordinates, now: number): boolean {
    if (
      !Number.isFinite(coords.accuracy) ||
      coords.accuracy < 0 ||
      coords.accuracy > 50 ||
      !Number.isFinite(coords.latitude) ||
      !Number.isFinite(coords.longitude)
    )
      return false;
    let next = coords.speed;
    let source: Telemetry["source"] = "gps";
    if (next === null || !Number.isFinite(next) || next < 0) {
      source = "position";
      if (!this.previous) {
        this.previous = { coords, now };
        return false;
      }
      const seconds = (now - this.previous.now) / 1000;
      if (seconds < 1) return false;
      if (
        seconds > 5 ||
        coords.accuracy > 25 ||
        this.previous.coords.accuracy > 25
      ) {
        this.previous = { coords, now };
        return false;
      }
      const moved = distance(this.previous.coords, coords);
      const uncertainty =
        (coords.accuracy + this.previous.coords.accuracy) * 0.5;
      next = moved < uncertainty ? 0 : moved / seconds;
    }
    const dt = (now - this.lastGood) / 1000;
    if (dt <= 0) return false;
    this.previous = { coords, now };
    if (
      next > 65 ||
      (this.speed !== null && dt < 3 && Math.abs(next - this.speed) / dt > 8)
    )
      return false;
    if (next < 0.3) next = 0;
    const old = this.speed;
    this.speed =
      old === null || dt >= 3
        ? next
        : old + (next - old) * (1 - Math.exp(-dt / 0.35));
    this.acceleration =
      old === null || dt >= 3
        ? 0
        : clamp(
            this.acceleration * 0.35 + ((this.speed - old) / dt) * 0.65,
            -5,
            5,
          );
    this.lastGood = now;
    this.accuracy = coords.accuracy;
    this.source = source;
    return true;
  }
  fresh(now: number) {
    return now - this.lastGood <= 3000;
  }
}

export class SensorService {
  private filter = new SpeedFilter();
  private watch?: number;
  private calibration: Telemetry["calibration"] = "off";
  private message = "Waiting for a GPS fix. Head outside for a clear signal.";
  private gravity: Vector = [0, 0, 0];
  private bias: Vector = [0, 0, 0];
  private forward: Vector | null = null;
  private baseline: { g: Vector; a: Vector }[] = [];
  private learning: Vector[] = [];
  private calibrationStarted = 0;
  private motionAcceleration = 0;
  private lastMotion = -Infinity;
  private disposed = false;
  private motionAllowed = false;
  start(motionAllowed: boolean) {
    if (!window.isSecureContext)
      throw new Error(
        "Open GolfLarp through your HTTPS address to enable location and motion.",
      );
    if (!navigator.geolocation)
      throw new Error(
        "This browser does not support location. You can still try Demo mode.",
      );
    this.motionAllowed = motionAllowed;
    this.watch = navigator.geolocation.watchPosition(
      (position) => {
        if (this.disposed || Date.now() - position.timestamp > 10000) return;
        if (this.filter.update(position.coords, performance.now()))
          this.message = "";
      },
      (error) => {
        if (this.disposed) return;
        this.message =
          error.code === 1
            ? "Location is blocked. Allow location for this site in Safari settings, then start again."
            : "GPS unavailable. Move outside with a clear view of the sky.";
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );
    if (motionAllowed) {
      window.addEventListener("devicemotion", this.onMotion);
      this.calibrate();
    }
  }
  calibrate() {
    if (!this.motionAllowed) return;
    this.calibration = "stationary";
    this.calibrationStarted = performance.now();
    this.baseline = [];
    this.learning = [];
    this.forward = null;
  }
  private onMotion = (event: DeviceMotionEvent) => {
    const now = performance.now();
    const g = vector(event.accelerationIncludingGravity);
    const a = vector(event.acceleration);
    if (!g) return;
    const gyro = Math.hypot(
      event.rotationRate?.alpha ?? 0,
      event.rotationRate?.beta ?? 0,
      event.rotationRate?.gamma ?? 0,
    );
    this.lastMotion = now;
    if (this.calibration === "stationary") {
      if ((this.filter.speed ?? 0) > 0.5 || gyro > 8 || (a && norm(a) > 0.4)) {
        this.baseline = [];
        this.calibrationStarted = now;
        return;
      }
      this.baseline.push({ g, a: a ?? [0, 0, 0] });
      if (now - this.calibrationStarted > 2500 && this.baseline.length >= 25) {
        this.gravity = [0, 1, 2].map(
          (i) =>
            this.baseline.reduce((s, v) => s + v.g[i], 0) /
            this.baseline.length,
        ) as Vector;
        this.bias = [0, 1, 2].map(
          (i) =>
            this.baseline.reduce((s, v) => s + v.a[i], 0) /
            this.baseline.length,
        ) as Vector;
        this.calibration = "learning";
      }
      return;
    }
    const raw = (
      a
        ? a.map((v, i) => v - this.bias[i])
        : g.map((v, i) => v - this.gravity[i])
    ) as Vector;
    if (
      norm(this.gravity) > 1 &&
      dot(g, this.gravity) / (norm(g) * norm(this.gravity)) < 0.9
    ) {
      this.calibration = "moved";
      this.forward = null;
      return;
    }
    if (gyro > 20) {
      this.motionAcceleration *= 0.8;
      return;
    } // Turning must not create throttle spikes.
    const gravityUnit = this.gravity.map(
      (v) => v / (norm(this.gravity) || 1),
    ) as Vector;
    const vertical = dot(raw, gravityUnit);
    const horizontal = raw.map(
      (v, i) => v - gravityUnit[i] * vertical,
    ) as Vector;
    if (
      this.calibration === "learning" &&
      this.filter.fresh(now) &&
      this.filter.acceleration > 0.25 &&
      norm(horizontal) > 0.2 &&
      norm(horizontal) < 3
    ) {
      this.learning.push(horizontal);
      if (this.learning.length >= 30) {
        const mean = [0, 1, 2].map(
          (i) =>
            this.learning.reduce((s, v) => s + v[i], 0) / this.learning.length,
        ) as Vector;
        if (norm(mean) > 0.2) {
          this.forward = mean.map((v) => v / norm(mean)) as Vector;
          this.calibration = "ready";
        } else this.learning = [];
      }
    }
    if (this.forward) {
      const value = dot(horizontal, this.forward);
      if (Math.abs(value) < 5)
        this.motionAcceleration += (value - this.motionAcceleration) * 0.12;
    }
  };
  read(now: number): Telemetry {
    const fresh = this.filter.fresh(now);
    const motion = this.calibration === "ready" && now - this.lastMotion < 500;
    return {
      speed: fresh ? this.filter.speed : null,
      acceleration: fresh
        ? motion
          ? 0.75 * this.motionAcceleration + 0.25 * this.filter.acceleration
          : this.filter.acceleration
        : 0,
      accuracy: this.filter.accuracy,
      source: fresh ? this.filter.source : "none",
      calibration: this.calibration,
      message:
        this.message ||
        (!fresh ? "GPS signal lost. Engine returning to idle." : ""),
    };
  }
  stop() {
    this.disposed = true;
    if (this.watch !== undefined) navigator.geolocation.clearWatch(this.watch);
    window.removeEventListener("devicemotion", this.onMotion);
  }
}

export function requestMotion(): Promise<boolean> {
  const Motion = window.DeviceMotionEvent as typeof DeviceMotionEvent & {
    requestPermission?: () => Promise<string>;
  };
  if (!Motion) return Promise.resolve(false);
  try {
    return Motion.requestPermission
      ? Motion.requestPermission()
          .then((p) => p === "granted")
          .catch(() => false)
      : Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}
