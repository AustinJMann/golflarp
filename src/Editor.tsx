import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Play, Square, Trash2, Upload } from "lucide-react";
import { AudioEngine } from "./audio";
import { cleanAssets, decodeAsset, isLoop, validatePackAudio } from "./packs";
import { ROLES, type Role, type Sample, type StoredPack } from "./types";

function Waveform({ buffer, sample }: { buffer: AudioBuffer; sample: Sample }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const data = buffer.getChannelData(0);
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.fillStyle = "#ffffff18";
    ctx.fillRect(
      (sample.start / buffer.duration) * el.width,
      0,
      ((sample.end - sample.start) / buffer.duration) * el.width,
      el.height,
    );
    ctx.fillStyle = "#bcbcbc";
    for (let x = 0; x < el.width; x++) {
      const from = Math.floor((x / el.width) * data.length);
      const to = Math.floor(((x + 1) / el.width) * data.length);
      let peak = 0;
      for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(data[i]));
      ctx.fillRect(
        x,
        el.height / 2 - (peak * el.height) / 2,
        1,
        Math.max(1, peak * el.height),
      );
    }
    ctx.strokeStyle = "#eeeeee";
    ctx.setLineDash([4, 4]);
    for (const point of [sample.loopStart, sample.loopEnd]) {
      const x = (point / buffer.duration) * el.width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, el.height);
      ctx.stroke();
    }
  }, [buffer, sample]);
  return (
    <canvas
      ref={canvas}
      width="760"
      height="100"
      className="waveform"
      aria-label="Audio waveform. Shaded region marks the trim; dashed lines mark loop points."
      role="img"
    />
  );
}

export function Editor({
  initial,
  audio,
  onSave,
  onCancel,
}: {
  initial: StoredPack;
  audio: AudioEngine;
  onSave: (pack: StoredPack) => Promise<void>;
  onCancel: () => void;
}) {
  const [pack, setPack] = useState(() => structuredClone(initial));
  const [role, setRole] = useState<Role>("idle");
  const [buffers, setBuffers] = useState<Record<string, AudioBuffer>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sample = pack.manifest.samples[role];
  const buffer = sample && buffers[sample.file];
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const decoded: Record<string, AudioBuffer> = {};
      try {
        for (const [file, blob] of Object.entries(initial.assets))
          decoded[file] = await decodeAsset(blob, audio.context);
        if (!cancelled) setBuffers(decoded);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      audio.stopPreview();
    };
  }, [initial, audio]);
  function updateSample(patch: Partial<Sample>) {
    audio.stopPreview();
    setPreviewing(false);
    setPack((p) => ({
      ...p,
      manifest: {
        ...p.manifest,
        samples: {
          ...p.manifest.samples,
          [role]: { ...p.manifest.samples[role]!, ...patch },
        },
      },
    }));
  }
  async function addSound(file: File) {
    setBusy(true);
    setError("");
    audio.stopPreview();
    setPreviewing(false);
    try {
      if (!/\.(wav|mp3)$/i.test(file.name))
        throw new Error("Choose a WAV or MP3 sound.");
      const decoded = await decodeAsset(file, audio.context);
      const filename = `assets/${crypto.randomUUID()}.${file.name.split(".").pop()!.toLowerCase()}`;
      const s: Sample = {
        file: filename,
        baseRpm: ROLES.find((r) => r.id === role)?.rpm ?? 3000,
        start: 0,
        end: decoded.duration,
        loopStart: 0,
        loopEnd: decoded.duration,
        gain: 0.8,
      };
      setPack((p) => ({
        manifest: {
          ...p.manifest,
          samples: { ...p.manifest.samples, [role]: s },
        },
        assets: { ...p.assets, [filename]: file },
      }));
      setBuffers((b) => ({ ...b, [filename]: decoded }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setError("");
    setBusy(true);
    audio.stopPreview();
    setPreviewing(false);
    try {
      const cleaned = cleanAssets(pack);
      await validatePackAudio(cleaned, audio.context);
      await onSave(cleaned);
    } catch (e) {
      setError(
        (e as Error).message ||
          "Could not save. Check available device storage.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page editor-page">
      <button className="text-button" onClick={onCancel} disabled={busy}>
        <ArrowLeft size={17} /> Back to garage
      </button>
      <h1>Engine workshop</h1>
      <div className="panel editor-meta">
        <label>
          Engine name
          <input
            maxLength={80}
            value={pack.manifest.name}
            onChange={(e) =>
              setPack((p) => ({
                ...p,
                manifest: { ...p.manifest, name: e.target.value },
              }))
            }
          />
        </label>
        <label>
          Description
          <input
            maxLength={2000}
            value={pack.manifest.description}
            onChange={(e) =>
              setPack((p) => ({
                ...p,
                manifest: { ...p.manifest, description: e.target.value },
              }))
            }
          />
        </label>
        <div className="field-row">
          <label>
            Idle RPM
            <input
              type="number"
              min="300"
              max="19500"
              value={pack.manifest.engine.idleRpm}
              onChange={(e) =>
                setPack((p) => ({
                  ...p,
                  manifest: {
                    ...p.manifest,
                    engine: {
                      ...p.manifest.engine,
                      idleRpm: Number(e.target.value),
                    },
                  },
                }))
              }
            />
          </label>
          <label>
            Redline RPM
            <input
              type="number"
              min="800"
              max="20000"
              value={pack.manifest.engine.redlineRpm}
              onChange={(e) =>
                setPack((p) => ({
                  ...p,
                  manifest: {
                    ...p.manifest,
                    engine: {
                      ...p.manifest.engine,
                      redlineRpm: Number(e.target.value),
                    },
                  },
                }))
              }
            />
          </label>
        </div>
        <label className="switch-row">
          <span>Turbo effects</span>
          <input
            type="checkbox"
            checked={pack.manifest.engine.turbo}
            onChange={(e) =>
              setPack((p) => ({
                ...p,
                manifest: {
                  ...p.manifest,
                  engine: { ...p.manifest.engine, turbo: e.target.checked },
                },
              }))
            }
          />
        </label>
      </div>
      <div className="panel sample-editor">
        <div className="section-heading">
          <h2>Sound layers</h2>
          <span className="muted">WAV / MP3 · 30 sec · 12 MB each</span>
        </div>
        <label>
          Layer
          <select
            aria-label="Sound layer"
            value={role}
            onChange={(e) => {
              audio.stopPreview();
              setPreviewing(false);
              setRole(e.target.value as Role);
              setError("");
            }}
          >
            {ROLES.map((r) => (
              <option key={r.id} value={r.id}>
                {pack.manifest.samples[r.id] ? "● " : "○ "}
                {r.label}
              </option>
            ))}
          </select>
        </label>
        {sample && buffer ? (
          <>
            <Waveform buffer={buffer} sample={sample} />
            <div className="field-row">
              <label>
                Trim start · seconds
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={buffer.duration}
                  value={sample.start}
                  onChange={(e) => {
                    const start = Number(e.target.value);
                    updateSample({
                      start,
                      loopStart: Math.max(start, sample.loopStart),
                    });
                  }}
                />
              </label>
              <label>
                Trim end · seconds
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={buffer.duration}
                  value={sample.end}
                  onChange={(e) => {
                    const end = Number(e.target.value);
                    updateSample({
                      end,
                      loopEnd: Math.min(end, sample.loopEnd),
                    });
                  }}
                />
              </label>
            </div>
            {isLoop(role) && (
              <>
                <div className="field-row">
                  <label>
                    Loop start · seconds
                    <input
                      type="number"
                      step="0.01"
                      value={sample.loopStart}
                      onChange={(e) =>
                        updateSample({ loopStart: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Loop end · seconds
                    <input
                      type="number"
                      step="0.01"
                      value={sample.loopEnd}
                      onChange={(e) =>
                        updateSample({ loopEnd: Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
                <label>
                  Recorded / reference RPM
                  <input
                    type="number"
                    min="100"
                    max="25000"
                    value={sample.baseRpm}
                    onChange={(e) =>
                      updateSample({ baseRpm: Number(e.target.value) })
                    }
                  />
                </label>
              </>
            )}
            <label>
              Layer gain · {Math.round(sample.gain * 100)}%
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={sample.gain}
                onChange={(e) => updateSample({ gain: Number(e.target.value) })}
              />
            </label>
            <div className="button-row">
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    if (previewing) audio.stopPreview();
                    else {
                      await audio.unlock();
                      if (
                        sample.start >= sample.end ||
                        sample.loopStart >= sample.loopEnd ||
                        sample.end > buffer.duration ||
                        sample.start < 0 ||
                        sample.loopStart < sample.start ||
                        sample.loopEnd > sample.end
                      )
                        throw new Error(
                          "Check the trim and loop points first.",
                        );
                      audio.preview(buffer, sample, isLoop(role));
                    }
                    setPreviewing(!previewing);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {previewing ? <Square size={16} /> : <Play size={16} />}
                {previewing ? "Stop preview" : "Preview layer"}
              </button>
              <button
                className="icon-button danger"
                aria-label="Remove sound layer"
                onClick={() => {
                  audio.stopPreview();
                  setPreviewing(false);
                  setPack((p) => {
                    const samples = { ...p.manifest.samples };
                    delete samples[role];
                    return { ...p, manifest: { ...p.manifest, samples } };
                  });
                }}
              >
                <Trash2 size={18} />
              </button>
            </div>
          </>
        ) : (
          <div className="empty-layer">
            <Upload size={26} />
            <p>{sample ? "Decoding sound…" : "No sound assigned."}</p>
            <span>
              {role === "idle"
                ? "An idle loop is required."
                : ["low", "mid", "high"].includes(role)
                  ? "Add at least one low, mid, or high RPM loop."
                  : "Optional. A generated effect or existing engine layer fills in."}
            </span>
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".wav,.mp3,audio/wav,audio/mpeg"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void addSound(file);
            e.target.value = "";
          }}
        />
        <button
          className="secondary full"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={16} />
          {sample ? "Replace sound file" : "Choose sound file"}
        </button>
        <p className="small muted">
          Use steady RPM recordings for loops. Set their reference RPM to keep
          pitch changes believable. Short matching loop boundaries sound best.
        </p>
      </div>
      <div className="panel">
        <label>
          Credits & source licenses
          <textarea
            rows={4}
            maxLength={10000}
            value={pack.manifest.credits}
            onChange={(e) =>
              setPack((p) => ({
                ...p,
                manifest: { ...p.manifest, credits: e.target.value },
              }))
            }
            placeholder="Who recorded these sounds? Keep any attribution here."
          />
        </label>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <button
        className="primary full"
        disabled={busy}
        onClick={() => void save()}
      >
        <Check size={18} />
        {busy ? "Checking sounds…" : "Save engine to this device"}
      </button>
    </section>
  );
}
