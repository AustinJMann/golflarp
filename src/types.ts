export type Role =
  | "idle"
  | "low"
  | "mid"
  | "high"
  | "coast"
  | "startup"
  | "shutdown"
  | "upshift"
  | "downshift"
  | "blowoff"
  | "turbo";
export const LOOP_ROLES: Role[] = [
  "idle",
  "low",
  "mid",
  "high",
  "coast",
  "turbo",
];
export const ROLES: { id: Role; label: string; rpm?: number }[] = [
  { id: "idle", label: "Idle loop", rpm: 950 },
  { id: "low", label: "Low RPM loop", rpm: 2000 },
  { id: "mid", label: "Mid RPM loop", rpm: 4000 },
  { id: "high", label: "High RPM loop", rpm: 6500 },
  { id: "coast", label: "Coasting loop", rpm: 3000 },
  { id: "turbo", label: "Turbo spool loop", rpm: 4000 },
  { id: "startup", label: "Engine start" },
  { id: "shutdown", label: "Engine stop" },
  { id: "upshift", label: "Upshift" },
  { id: "downshift", label: "Downshift" },
  { id: "blowoff", label: "Turbo discharge" },
];
export interface Sample {
  file: string;
  baseRpm: number;
  gain: number;
  start: number;
  end: number;
  loopStart: number;
  loopEnd: number;
}
export interface SoundPack {
  version: 1;
  id: string;
  name: string;
  description: string;
  credits: string;
  engine: { idleRpm: number; redlineRpm: number; turbo: boolean };
  samples: Partial<Record<Role, Sample>>;
}
export interface StoredPack {
  manifest: SoundPack;
  assets: Record<string, Blob>;
}
export interface Settings {
  unit: "mph" | "kmh";
  topSpeedMps: number;
  zeroTo25Seconds: number;
  packId: string;
  keepAwake: boolean;
}
export const ZERO_TO_25_MPS = 25 / 2.2369362921;
export const DEFAULT_SETTINGS: Settings = {
  unit: "mph",
  topSpeedMps: ZERO_TO_25_MPS,
  zeroTo25Seconds: 10,
  packId: "builtin-sport",
  keepAwake: true,
};
export const speedIn = (mps: number, unit: Settings["unit"]) =>
  mps * (unit === "mph" ? 2.2369362921 : 3.6);
export const speedOut = (speed: number, unit: Settings["unit"]) =>
  speed / (unit === "mph" ? 2.2369362921 : 3.6);
export interface Telemetry {
  speed: number | null;
  acceleration: number;
  accuracy: number | null;
  source: "gps" | "position" | "demo" | "none";
  calibration: "off" | "stationary" | "learning" | "ready" | "moved";
  message: string;
}
export type EngineEvent = "upshift" | "downshift" | "blowoff";
export interface EngineFrame {
  rpm: number;
  gear: number;
  throttle: number;
  boost: number;
  events: EngineEvent[];
  shifting: boolean;
}
export const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));
