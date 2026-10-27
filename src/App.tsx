import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  Activity,
  ArrowRight,
  AudioLines,
  Check,
  ChevronRight,
  Copy,
  Download,
  House,
  Info,
  Play,
  Plus,
  RotateCcw,
  Share,
  ShieldCheck,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  Wrench,
  X,
} from "lucide-react";
import { AudioEngine } from "./audio";
import { Editor } from "./Editor";
import { EngineModel } from "./model";
import {
  bundledPack,
  DEFAULT_PACK,
  exportPack,
  importPack,
  newPack,
  validatePackAudio,
} from "./packs";
import { requestMotion, SensorService } from "./sensors";
import {
  deletePack,
  listPacks,
  loadSettings,
  requestPersistence,
  savePack,
  saveSettings,
} from "./storage";
import {
  clamp,
  DEFAULT_SETTINGS,
  speedIn,
  speedOut,
  type EngineFrame,
  type Settings,
  type StoredPack,
  type Telemetry,
} from "./types";

type Page = "drive" | "garage" | "settings";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
const idleTelemetry: Telemetry = {
  speed: null,
  acceleration: 0,
  accuracy: null,
  source: "none",
  calibration: "off",
  message: "",
};
const idleFrame: EngineFrame = {
  rpm: 950,
  gear: 1,
  throttle: 0,
  boost: 0,
  events: [],
  shifting: false,
};
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="section-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>("drive");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [packs, setPacks] = useState<StoredPack[]>([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);
  const [telemetry, setTelemetry] = useState<Telemetry>(idleTelemetry);
  const [frame, setFrame] = useState<EngineFrame>(idleFrame);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [muted, setMuted] = useState(false);
  const [editing, setEditing] = useState<StoredPack | null>(null);
  const [modal, setModal] = useState<
    "install" | "calibrate" | "credits" | "delete" | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<StoredPack | null>(null);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      !!(navigator as Navigator & { standalone?: boolean }).standalone,
  );
  const [persistent, setPersistent] = useState(false);
  const [demoSpeed, setDemoSpeed] = useState(0);
  const [demoThrottle, setDemoThrottle] = useState(0.55);
  const [topSpeedText, setTopSpeedText] = useState("25");
  const [zeroTo25Text, setZeroTo25Text] = useState(
    String(DEFAULT_SETTINGS.zeroTo25Seconds),
  );
  useEffect(() => {
    setZeroTo25Text(String(settings.zeroTo25Seconds));
  }, [settings.zeroTo25Seconds]);
  const audioRef = useRef<AudioEngine | null>(null);
  const sensors = useRef<SensorService | null>(null);
  const model = useRef(new EngineModel());
  const activePack = useRef(DEFAULT_PACK);
  const defaultCache = useRef<Promise<StoredPack> | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const demoValues = useRef({ speed: demoSpeed, throttle: demoThrottle });
  demoValues.current = { speed: demoSpeed, throttle: demoThrottle };
  const generation = useRef(0);
  const importInput = useRef<HTMLInputElement>(null);
  const [needRefresh, setNeedRefresh] = useState(false);
  const { updateServiceWorker } = useRegisterSW({
    onNeedRefresh() {
      setNeedRefresh(true);
    },
    onRegisterError(e) {
      console.warn("Offline registration unavailable", e);
    },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [saved, library] = await Promise.all([
          loadSettings(),
          listPacks(),
        ]);
        if (cancelled) return;
        setPacks(library);
        setSettings({
          ...saved,
          packId:
            saved.packId === DEFAULT_PACK.id ||
            library.some((p) => p.manifest.id === saved.packId)
              ? saved.packId
              : DEFAULT_PACK.id,
        });
        if (navigator.storage?.persisted)
          setPersistent(await navigator.storage.persisted());
      } catch {
        if (!cancelled)
          setError(
            "Device storage is unavailable. The default engine still works, but custom sounds cannot be saved in this browser.",
          );
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timeout = window.setTimeout(() => {
      void saveSettings(settings).catch(() =>
        setError(
          "Preferences could not be saved. Check available device storage.",
        ),
      );
    }, 350);
    return () => clearTimeout(timeout);
  }, [settings, ready]);
  useEffect(() => {
    setTopSpeedText(
      String(
        Math.round(speedIn(settings.topSpeedMps, settings.unit) * 10) / 10,
      ),
    );
  }, [settings.topSpeedMps, settings.unit]);
  useEffect(() => {
    audioRef.current?.setVolume(muted ? 0 : 1);
  }, [muted]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    const prompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallEvent);
    };
    const install = () => {
      setInstalled(true);
      setInstallEvent(null);
      setModal(null);
    };
    window.addEventListener("beforeinstallprompt", prompt);
    window.addEventListener("appinstalled", install);
    return () => {
      window.removeEventListener("beforeinstallprompt", prompt);
      window.removeEventListener("appinstalled", install);
    };
  }, []);
  const stop = useCallback((interrupted = false) => {
    generation.current++;
    sensors.current?.stop();
    sensors.current = null;
    if (interrupted) audioRef.current?.stop();
    else audioRef.current?.finish();
    setRunning(false);
    setBusy(false);
    setPaused(interrupted);
    setTelemetry(idleTelemetry);
    setFrame(idleFrame);
  }, []);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        stop(true);
        audioRef.current?.stopPreview();
      }
    };
    document.addEventListener("visibilitychange", hide);
    const pageHide = () => stop(true);
    window.addEventListener("pagehide", pageHide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", pageHide);
      generation.current++;
      sensors.current?.stop();
      void audioRef.current?.close();
    };
  }, [stop]);
  useEffect(() => {
    if (!running || !settings.keepAwake || !navigator.wakeLock) {
      return;
    }
    let lock: WakeLockSentinel | undefined;
    let cancelled = false;
    navigator.wakeLock
      .request("screen")
      .then((sentinel) => {
        if (cancelled) {
          void sentinel.release();
          return;
        }
        lock = sentinel;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (lock && !lock.released) void lock.release();
    };
  }, [running, settings.keepAwake]);
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let previous = performance.now();
    let lastUi = 0;
    let currentDemoSpeed = 0;
    function tick(now: number) {
      const dt = Math.min(0.1, (now - previous) / 1000);
      if (now - previous < 25) {
        raf = requestAnimationFrame(tick);
        return;
      }
      previous = now;
      let reading: Telemetry;
      if (demo) {
        const old = currentDemoSpeed;
        currentDemoSpeed += clamp(
          demoValues.current.speed - currentDemoSpeed,
          -2.5 * dt,
          2 * dt,
        );
        reading = {
          speed: currentDemoSpeed,
          acceleration: (currentDemoSpeed - old) / dt,
          accuracy: null,
          source: "demo",
          calibration: "off",
          message: "",
        };
      } else reading = sensors.current?.read(now) ?? idleTelemetry;
      const next = model.current.step(
        reading.speed,
        reading.acceleration,
        settingsRef.current.topSpeedMps,
        activePack.current.engine,
        now,
        dt,
        demo ? demoValues.current.throttle : undefined,
        settingsRef.current.zeroTo25Seconds,
      );
      audioRef.current?.update(next);
      if (now - lastUi >= 75) {
        lastUi = now;
        setFrame(next);
        setTelemetry(reading);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, demo]);

  function audio() {
    if (!audioRef.current || audioRef.current.context.state === "closed") {
      audioRef.current = new AudioEngine();
      audioRef.current.context.addEventListener("statechange", () => {
        const state = audioRef.current?.context.state as string;
        if (state === "interrupted" || state === "suspended") stop(true);
      });
    }
    audioRef.current.setVolume(mutedRef.current ? 0 : 1);
    return audioRef.current;
  }
  async function resolvePack(id: string) {
    if (id === DEFAULT_PACK.id) {
      if (!defaultCache.current)
        defaultCache.current = bundledPack().catch((e) => {
          defaultCache.current = null;
          throw e;
        });
      return defaultCache.current;
    }
    const found = packs.find((p) => p.manifest.id === id);
    if (!found) throw new Error("That engine is no longer in the garage.");
    return found;
  }
  async function start() {
    setError("");
    setBusy(true);
    const token = ++generation.current;
    let engine: AudioEngine;
    try {
      engine = audio();
      // Both gesture-gated calls happen before any await, including asset loads.
      const unlocked = engine.unlock();
      const motionPermission = demo ? Promise.resolve(false) : requestMotion();
      await unlocked;
      const pack = await resolvePack(settings.packId);
      await engine.load(pack);
      const motion = await motionPermission;
      if (token !== generation.current || document.hidden) return;
      if (!demo) {
        const service = new SensorService();
        sensors.current = service;
        service.start(motion);
        if (!motion)
          setToast(
            "Motion unavailable. GPS speed and acceleration are still active.",
          );
      }
      activePack.current = pack.manifest;
      model.current.reset();
      engine.start();
      setPaused(false);
      setRunning(true);
      void requestPersistence()
        .then(setPersistent)
        .catch(() => undefined);
    } catch (e) {
      stop();
      setError((e as Error).message || "Could not start the engine.");
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  async function openEditor(pack?: StoredPack) {
    stop();
    setBusy(true);
    setError("");
    try {
      const engine = audio();
      await engine.unlock();
      const source = pack ?? newPack();
      setEditing(source);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function duplicate(id: string) {
    stop();
    setError("");
    setBusy(true);
    try {
      const engine = audio();
      const unlocked = engine.unlock();
      const source = await resolvePack(id);
      await unlocked;
      const clone = structuredClone(source);
      clone.manifest.id = crypto.randomUUID();
      clone.manifest.name = `${clone.manifest.name.slice(0, 70)} copy`;
      setEditing(clone);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveEdited(pack: StoredPack) {
    try {
      await savePack(pack);
    } catch {
      throw new Error(
        "Could not save this engine. Free device storage or try outside Private Browsing. Your editor changes are still here.",
      );
    }
    setPacks(await listPacks());
    setSettings((s) => ({ ...s, packId: pack.manifest.id }));
    setEditing(null);
    setPage("garage");
    setToast("Engine saved. It will be here next time.");
    void requestPersistence()
      .then(setPersistent)
      .catch(() => undefined);
  }
  async function handleImport(file: File) {
    stop();
    setBusy(true);
    setError("");
    try {
      const pack = await importPack(file);
      const engine = audio();
      await validatePackAudio(pack, engine.context);
      await savePack(pack);
      setPacks(await listPacks());
      setSettings((s) => ({ ...s, packId: pack.manifest.id }));
      setToast("Sound pack imported and saved to this device.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function handleExport(id: string) {
    setBusy(true);
    setError("");
    try {
      const pack = await resolvePack(id);
      const blob = await exportPack(pack);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${pack.manifest.name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase()}.golflarp.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function changePage(next: Page) {
    if (next !== "drive") stop();
    setPage(next);
    setError("");
    setZeroTo25Text(String(settings.zeroTo25Seconds));
  }
  const displaySpeed =
    telemetry.speed === null
      ? "—"
      : String(Math.round(speedIn(telemetry.speed, settings.unit)));
  const calibrationText = {
    off: "GPS response",
    stationary: "Keep the cart still for 3 seconds",
    learning: "Drive gently in a straight line",
    ready: "Motion calibrated",
    moved: "Phone moved · recalibrate",
  }[telemetry.calibration];
  return (
    <div className="app-shell">
      {(page !== "drive" || editing) && (
        <header className="topbar">
          <button
            className="brand"
            onClick={() => changePage("drive")}
            aria-label="GolfLarp home"
          >
            GolfLarp
          </button>
        </header>
      )}
      <main>
        {error && (
          <div className="notice error global-notice" role="alert">
            <Info size={17} />
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {editing ? (
          <Editor
            key={editing.manifest.id}
            initial={editing}
            audio={audioRef.current!}
            onSave={saveEdited}
            onCancel={() => {
              audioRef.current?.stopPreview();
              setEditing(null);
            }}
          />
        ) : page === "drive" ? (
          <section className="page drive-page" aria-label="Speedometer">
            <div
              className="speed-display"
              aria-label={`Current speed ${displaySpeed} ${settings.unit}`}
            >
              <span className="speed-digits">{displaySpeed}</span>
              <span className="speed-unit">
                {settings.unit === "mph" ? "MPH" : "KM/H"}
              </span>
            </div>
            <div className="drive-reading">
              {running
                ? `Gear ${frame.gear} · ${Math.round(frame.rpm).toLocaleString()} RPM`
                : paused
                  ? "Paused"
                  : ""}
            </div>
            <div className="drive-buttons">
              <button
                className="primary start-button"
                disabled={busy || !ready}
                onClick={() => (running ? stop() : void start())}
              >
                {busy
                  ? "Loading…"
                  : running
                    ? "Stop engine"
                    : paused
                      ? "Resume engine"
                      : "Start engine"}
              </button>
              <button
                className="icon-button"
                aria-label={muted ? "Unmute" : "Mute"}
                aria-pressed={muted}
                onClick={() => setMuted((v) => !v)}
              >
                {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
              </button>
            </div>
            <div className="mode-switch" aria-label="Input mode">
              <button
                className={!demo ? "active" : ""}
                aria-pressed={!demo}
                disabled={running || busy}
                onClick={() => {
                  setDemo(false);
                  setPaused(false);
                  setTelemetry(idleTelemetry);
                }}
              >
                Live drive
              </button>
              <button
                className={demo ? "active" : ""}
                aria-pressed={demo}
                disabled={running || busy}
                onClick={() => {
                  setDemo(true);
                  setPaused(false);
                  setTelemetry(idleTelemetry);
                }}
              >
                Demo mode
              </button>
            </div>
            {running && !demo && (
              <div className="sensor-status">
                {telemetry.message && <p role="status">{telemetry.message}</p>}
                {!telemetry.message &&
                  telemetry.calibration !== "off" &&
                  telemetry.calibration !== "ready" && (
                    <p role="status">{calibrationText}</p>
                  )}
                <button
                  className="text-button"
                  onClick={() => setModal("calibrate")}
                >
                  Calibrate
                </button>
              </div>
            )}
            {demo && (
              <div className="demo-controls">
                <label>
                  <span className="range-label">
                    Speed{" "}
                    <span>
                      {Math.round(speedIn(demoSpeed, settings.unit))}{" "}
                      {settings.unit === "mph" ? "mph" : "km/h"}
                    </span>
                  </span>
                  <input
                    aria-label="Demo target speed"
                    type="range"
                    min="0"
                    max={settings.topSpeedMps * 1.25}
                    step="0.05"
                    value={demoSpeed}
                    onChange={(e) => setDemoSpeed(Number(e.target.value))}
                  />
                </label>
                <label>
                  <span className="range-label">
                    Throttle <span>{Math.round(demoThrottle * 100)}%</span>
                  </span>
                  <input
                    aria-label="Demo throttle"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={demoThrottle}
                    onChange={(e) => setDemoThrottle(Number(e.target.value))}
                  />
                </label>
              </div>
            )}
          </section>
        ) : page === "garage" ? (
          <section className="page garage-page">
            <h1>Garage</h1>
            <article
              className={`pack-card default-pack ${settings.packId === DEFAULT_PACK.id ? "selected" : ""}`}
            >
              <div className="pack-body">
                <h2>Club Sport</h2>
                <p className="muted">Default engine</p>
                <button
                  className={
                    settings.packId === DEFAULT_PACK.id
                      ? "secondary full selected-button"
                      : "primary full"
                  }
                  onClick={() => {
                    setSettings((s) => ({ ...s, packId: DEFAULT_PACK.id }));
                    setToast("Club Sport selected.");
                  }}
                >
                  {settings.packId === DEFAULT_PACK.id ? (
                    <Check size={17} />
                  ) : (
                    <Play size={17} />
                  )}
                  {settings.packId === DEFAULT_PACK.id
                    ? "Ready to drive"
                    : "Use this engine"}
                </button>
                <div className="pack-actions">
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void duplicate(DEFAULT_PACK.id)}
                  >
                    <Copy size={15} />
                    Customize a copy
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Export Club Sport"
                    disabled={busy}
                    onClick={() => void handleExport(DEFAULT_PACK.id)}
                  >
                    <Download size={17} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Sound credits"
                    onClick={() => setModal("credits")}
                  >
                    <Info size={17} />
                  </button>
                </div>
              </div>
            </article>
            <div className="section-heading library-heading">
              <h2>
                Your engines <span className="count">{packs.length}</span>
              </h2>
              <span className="micro">ON THIS DEVICE</span>
            </div>
            {packs.map((pack) => (
              <article
                className={`panel custom-pack ${settings.packId === pack.manifest.id ? "selected" : ""}`}
                key={pack.manifest.id}
              >
                <div className="section-heading">
                  <div className="custom-pack-name">
                    <AudioLines size={24} />
                    <h2>{pack.manifest.name}</h2>
                  </div>
                  {settings.packId === pack.manifest.id && (
                    <span className="tag">SELECTED</span>
                  )}
                </div>
                <p>
                  {pack.manifest.description ||
                    "A custom engine, made your way."}
                </p>
                <div className="button-row">
                  <button
                    className="secondary"
                    onClick={() => {
                      setSettings((s) => ({ ...s, packId: pack.manifest.id }));
                      setToast(`${pack.manifest.name} selected.`);
                    }}
                  >
                    {settings.packId === pack.manifest.id ? (
                      <Check size={16} />
                    ) : (
                      <Play size={16} />
                    )}
                    Use engine
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Edit ${pack.manifest.name}`}
                    disabled={busy}
                    onClick={() => void openEditor(pack)}
                  >
                    <Wrench size={17} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Duplicate ${pack.manifest.name}`}
                    disabled={busy}
                    onClick={() => void duplicate(pack.manifest.id)}
                  >
                    <Copy size={17} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Export ${pack.manifest.name}`}
                    disabled={busy}
                    onClick={() => void handleExport(pack.manifest.id)}
                  >
                    <Download size={17} />
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={`Delete ${pack.manifest.name}`}
                    disabled={busy}
                    onClick={() => {
                      setDeleteTarget(pack);
                      setModal("delete");
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            ))}
            <div className="garage-create">
              <button
                className="create-button"
                disabled={busy}
                onClick={() => void openEditor()}
              >
                <Plus size={24} />
                <strong>Build an engine</strong>
              </button>
              <button
                className="create-button"
                disabled={busy}
                onClick={() => importInput.current?.click()}
              >
                <Upload size={24} />
                <strong>Import a pack</strong>
              </button>
            </div>
            <input
              ref={importInput}
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImport(file);
                e.target.value = "";
              }}
            />
            <p className="small muted storage-note">
              Sounds are saved on this device. Export packs for backup.
              {persistent ? " Persistent storage enabled." : ""}
            </p>
          </section>
        ) : (
          <section className="page settings-page">
            <h1>Settings</h1>
            <div className="panel">
              <h2>Vehicle</h2>
              <label>
                Speed units
                <select
                  value={settings.unit}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      unit: e.target.value as Settings["unit"],
                    }))
                  }
                >
                  <option value="mph">Miles per hour (MPH)</option>
                  <option value="kmh">Kilometers per hour (KM/H)</option>
                </select>
              </label>
              <label>
                Vehicle top speed · {settings.unit === "mph" ? "mph" : "km/h"}
                <div className="input-action">
                  <input
                    aria-label="Vehicle top speed"
                    type="number"
                    inputMode="decimal"
                    min="1"
                    max={Math.round(speedIn(65, settings.unit))}
                    step="0.1"
                    value={topSpeedText}
                    onChange={(e) => setTopSpeedText(e.target.value)}
                  />
                  <button
                    className="secondary"
                    onClick={() => {
                      const value = speedOut(
                        Number(topSpeedText),
                        settings.unit,
                      );
                      if (
                        !topSpeedText ||
                        !Number.isFinite(value) ||
                        value < 1 ||
                        value > 65
                      ) {
                        setError(
                          `Enter a top speed between ${Math.ceil(speedIn(1, settings.unit))} and ${Math.floor(speedIn(65, settings.unit))} ${settings.unit}.`,
                        );
                        return;
                      }
                      setSettings((s) => ({ ...s, topSpeedMps: value }));
                      setError("");
                      setToast("Virtual gearing updated.");
                    }}
                  >
                    Save
                  </button>
                </div>
              </label>
              <p className="small muted">
                Default: 25 mph. Tunes the five virtual gears to your cart. Your
                actual speed display is never capped.
              </p>
              <label>
                0–25 mph time · seconds
                <div className="input-action">
                  <input
                    aria-label="0–25 mph time"
                    type="number"
                    inputMode="decimal"
                    min="1"
                    max="120"
                    step="0.1"
                    value={zeroTo25Text}
                    onChange={(e) => setZeroTo25Text(e.target.value)}
                  />
                  <button
                    className="secondary"
                    onClick={() => {
                      const seconds = Number(zeroTo25Text);
                      if (
                        !zeroTo25Text.trim() ||
                        !Number.isFinite(seconds) ||
                        seconds < 1 ||
                        seconds > 120
                      ) {
                        setError(
                          "Enter a 0–25 mph time between 1 and 120 seconds.",
                        );
                        return;
                      }
                      setSettings((s) => ({ ...s, zeroTo25Seconds: seconds }));
                      setError("");
                      setToast("Acceleration response saved.");
                    }}
                  >
                    Save time
                  </button>
                </div>
              </label>
              <p className="small muted">
                Your full-throttle 0–25 mph (0–40 km/h) time. Used to scale the
                throttle estimate from acceleration; default 10 seconds.
              </p>
            </div>
            <div className="panel">
              <h2>Phone & sensors</h2>
              <label className="switch-row">
                <span>
                  Keep screen awake<small>While the engine is running</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.keepAwake}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, keepAwake: e.target.checked }))
                  }
                />
              </label>
              <button
                className="secondary full"
                onClick={() => setModal("calibrate")}
              >
                <Activity size={17} /> Motion calibration guide
              </button>
              <p className="small muted">
                Location measures speed. A calibrated, fixed phone helps the
                engine react to acceleration. The app must stay visible; locking
                your phone or switching apps pauses the engine.
              </p>
            </div>
            <div className="panel">
              <h2>App</h2>
              <button
                className="settings-link"
                onClick={() => setModal("install")}
              >
                <House size={19} />
                <span>
                  {installed
                    ? "Home Screen app installed"
                    : "Add to Home Screen"}
                </span>
                <ChevronRight size={17} />
              </button>
              <button
                className="settings-link"
                onClick={() => setModal("credits")}
              >
                <AudioLines size={19} />
                <span>Default sound credits</span>
                <ChevronRight size={17} />
              </button>
              <button
                className="settings-link"
                onClick={() => {
                  void requestPersistence()
                    .then((result) => {
                      setPersistent(result);
                      setToast(
                        result
                          ? "Persistent storage enabled."
                          : "Browser kept standard storage. Export packs for a backup.",
                      );
                    })
                    .catch(() =>
                      setError("Storage permission could not be requested."),
                    );
                }}
              >
                <ShieldCheck size={19} />
                <span>
                  {persistent
                    ? "Persistent storage enabled"
                    : "Request persistent storage"}
                </span>
                <ChevronRight size={17} />
              </button>
            </div>
          </section>
        )}
        {needRefresh && !running && !busy && !editing && (
          <div className="update-banner">
            <span>Update available.</span>
            <button
              className="text-button"
              onClick={() => {
                setNeedRefresh(false);
                void updateServiceWorker(true);
              }}
            >
              Update app <ArrowRight size={15} />
            </button>
          </div>
        )}
      </main>
      {!editing && (
        <nav className="bottom-nav" aria-label="Main navigation">
          {(
            [
              { id: "drive", label: "Drive" },
              { id: "garage", label: "Garage" },
              { id: "settings", label: "Settings" },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              aria-current={page === id ? "page" : undefined}
              onClick={() => changePage(id)}
            >
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {modal === "install" && (
        <Modal title="Add to Home Screen" onClose={() => setModal(null)}>
          {installed ? (
            <div className="notice">
              <Check size={18} />
              You’re already using the Home Screen app.
            </div>
          ) : installEvent ? (
            <button
              className="primary full"
              onClick={() => {
                void installEvent
                  .prompt()
                  .then(() => installEvent.userChoice)
                  .then((choice) => {
                    if (choice.outcome === "accepted") setModal(null);
                    setInstallEvent(null);
                  });
              }}
            >
              <Download size={17} />
              Install GolfLarp
            </button>
          ) : (
            <ol className="install-steps">
              <li>
                <span>
                  <Share size={18} />
                </span>
                <div>
                  Open this page in <strong>Safari</strong>.
                  <small>Use your public HTTPS address.</small>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  Tap <strong>Share</strong>.
                  <small>It may be inside Safari’s More menu.</small>
                </div>
              </li>
              <li>
                <span>
                  <Plus size={18} />
                </span>
                <div>
                  Choose <strong>Add to Home Screen</strong>.
                  <small>
                    Turn on “Open as Web App” if shown, then tap Add.
                  </small>
                </div>
              </li>
            </ol>
          )}
          <p className="small muted">
            Android: use your browser’s Install app or Add to Home Screen menu.
            Open once online to cache the app and default sounds.
          </p>
        </Modal>
      )}
      {modal === "calibrate" && (
        <Modal title="Calibration" onClose={() => setModal(null)}>
          <ol className="install-steps">
            <li>
              <span>1</span>
              <div>
                <strong>Mount your phone securely.</strong>
                <small>
                  Keep it in the same position throughout your drive.
                </small>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Stay still for 3 seconds.</strong>
                <small>
                  Start a live session, or tap Recalibrate below while stopped.
                </small>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Accelerate gently in a straight line.</strong>
                <small>
                  The app learns the cart’s forward direction. GPS speed works
                  throughout.
                </small>
              </div>
            </li>
          </ol>
          <p className="small muted">
            Recalibrate if you move the phone. Bumps and turns are filtered, but
            GPS and phone sensors are estimates. A GPS-only response is used if
            motion access is unavailable.
          </p>
          <button
            className="primary full"
            disabled={
              !running ||
              demo ||
              telemetry.calibration === "off" ||
              (telemetry.speed ?? 0) > 0.5
            }
            onClick={() => {
              sensors.current?.calibrate();
              setModal(null);
              setToast("Keep the mounted phone still for 3 seconds.");
            }}
          >
            <RotateCcw size={17} />
            Recalibrate while stopped
          </button>
        </Modal>
      )}
      {modal === "credits" && (
        <Modal title="Sound credits" onClose={() => setModal(null)}>
          <h3>Club Sport · default engine</h3>
          <p>
            Engine loop recorded by <strong>qubodup</strong>, licensed under{" "}
            <a
              href="https://creativecommons.org/licenses/by/3.0/"
              target="_blank"
              rel="noreferrer"
            >
              CC BY 3.0
            </a>
            . Trimmed, filtered, crossfaded, and layered for GolfLarp.
          </p>
          <a
            className="source-link"
            href="https://opengameart.org/content/car-engine-loop-96khz-4s"
            target="_blank"
            rel="noreferrer"
          >
            Original engine recording <ArrowRight size={15} />
          </a>
          <p>
            The same engine recording is used for idle and driving. Throttle
            shapes its volume and tone. Startup, shutdown, shifts, turbo airflow
            and discharge are generated.
          </p>
          <a
            className="source-link"
            href="/CREDITS.md"
            target="_blank"
            rel="noreferrer"
          >
            Full asset and processing notes <ArrowRight size={15} />
          </a>
        </Modal>
      )}
      {modal === "delete" && deleteTarget && (
        <Modal title="Remove this engine?" onClose={() => setModal(null)}>
          <p>
            “{deleteTarget.manifest.name}” and its sounds will be removed from
            this device. Export a backup first if you want to keep it.
          </p>
          <div className="button-row">
            <button className="secondary" onClick={() => setModal(null)}>
              Keep engine
            </button>
            <button
              className="secondary danger"
              onClick={() => {
                const id = deleteTarget.manifest.id;
                void deletePack(id)
                  .then(async () => {
                    setPacks(await listPacks());
                    if (settings.packId === id)
                      setSettings((s) => ({ ...s, packId: DEFAULT_PACK.id }));
                    setModal(null);
                    setDeleteTarget(null);
                    setToast("Engine removed from this device.");
                  })
                  .catch(() => setError("Could not remove the engine."));
              }}
            >
              <Trash2 size={16} />
              Remove engine
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
