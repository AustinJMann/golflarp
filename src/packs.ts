import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  LOOP_ROLES,
  ROLES,
  type Sample,
  type SoundPack,
  type StoredPack,
} from "./types";

export const MAX_FILE_BYTES = 12 * 1024 * 1024;
export const MAX_PACK_BYTES = 80 * 1024 * 1024;
const sample = (
  file: string,
  baseRpm: number,
  end: number,
  gain = 1,
): Sample => ({
  file,
  baseRpm,
  gain,
  start: 0,
  end,
  loopStart: 0,
  loopEnd: end,
});
export const DEFAULT_PACK: SoundPack = {
  version: 1,
  id: "builtin-sport",
  name: "Club Sport",
  description:
    "A single-recording engine with automatic gears and turbo effects.",
  credits:
    "Engine recording by qubodup, CC BY 3.0, https://opengameart.org/content/car-engine-loop-96khz-4s. One recording is used throughout the RPM range; load is shaped with filtering and gain. Startup, shutdown, shifts and turbo effects are generated. See CREDITS.md.",
  engine: { idleRpm: 950, redlineRpm: 7000, turbo: true },
  samples: {
    idle: sample("assets/engine.wav", 2600, 3.8),
    low: sample("assets/engine.wav", 2600, 3.8),
  },
};
export function newPack(): StoredPack {
  return {
    manifest: {
      version: 1,
      id: crypto.randomUUID(),
      name: "My engine",
      description: "",
      credits: "",
      engine: { idleRpm: 950, redlineRpm: 7000, turbo: true },
      samples: {},
    },
    assets: {},
  };
}
export async function bundledPack(): Promise<StoredPack> {
  const assets: StoredPack["assets"] = {};
  await Promise.all(
    [...new Set(Object.values(DEFAULT_PACK.samples).map((s) => s.file))].map(
      async (file) => {
        const response = await fetch(`/sounds/${file.slice(7)}`);
        if (!response.ok)
          throw new Error(
            "Default sounds could not be loaded. Connect once to save them for offline use.",
          );
        assets[file] = await response.blob();
      },
    ),
  );
  return { manifest: structuredClone(DEFAULT_PACK), assets };
}
export function validateManifest(value: unknown): SoundPack {
  if (!value || typeof value !== "object")
    throw new Error("The pack manifest is missing.");
  const pack = value as SoundPack;
  if (pack.version !== 1)
    throw new Error("Unsupported sound-pack version. Expected version 1.");
  if (
    typeof pack.id !== "string" ||
    !pack.id ||
    typeof pack.name !== "string" ||
    !pack.name.trim() ||
    pack.name.length > 80
  )
    throw new Error("Give the engine a name of 1–80 characters.");
  if (
    typeof pack.description !== "string" ||
    pack.description.length > 2000 ||
    typeof pack.credits !== "string" ||
    pack.credits.length > 10000
  )
    throw new Error("Description or credits are invalid or too long.");
  if (
    !pack.engine ||
    !Number.isFinite(pack.engine.idleRpm) ||
    !Number.isFinite(pack.engine.redlineRpm) ||
    pack.engine.idleRpm < 300 ||
    pack.engine.redlineRpm > 20000 ||
    pack.engine.redlineRpm <= pack.engine.idleRpm + 500 ||
    typeof pack.engine.turbo !== "boolean"
  )
    throw new Error(
      "Engine RPM range is invalid. Redline must exceed idle by at least 500 RPM.",
    );
  if (
    !pack.samples ||
    typeof pack.samples !== "object" ||
    Array.isArray(pack.samples)
  )
    throw new Error("Sample mappings are missing.");
  for (const [role, s] of Object.entries(pack.samples)) {
    if (
      !ROLES.some((r) => r.id === role) ||
      !s ||
      typeof s.file !== "string" ||
      !/^assets\/[a-zA-Z0-9_.-]+\.(wav|mp3)$/i.test(s.file)
    )
      throw new Error("Invalid sample role or file path.");
    if (
      ![s.baseRpm, s.gain, s.start, s.end, s.loopStart, s.loopEnd].every(
        Number.isFinite,
      ) ||
      s.baseRpm < 100 ||
      s.baseRpm > 25000 ||
      s.gain < 0 ||
      s.gain > 2 ||
      s.start < 0 ||
      s.end > 30 ||
      s.end - s.start < 0.02 ||
      s.loopStart < s.start ||
      s.loopEnd > s.end ||
      s.loopEnd - s.loopStart < 0.02
    )
      throw new Error(
        `Invalid trim, loop, gain, or reference RPM for ${role}. Clips must be 30 seconds or shorter.`,
      );
  }
  if (
    !pack.samples.idle ||
    !["low", "mid", "high"].some((role) => role in pack.samples)
  )
    throw new Error(
      "Add an idle loop and at least one low, mid, or high RPM loop.",
    );
  return pack;
}
export async function decodeAsset(
  blob: Blob,
  context: BaseAudioContext,
): Promise<AudioBuffer> {
  if (!blob.size || blob.size > MAX_FILE_BYTES)
    throw new Error("Each sound must be between 1 byte and 12 MB.");
  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new Error(
      "This sound could not be decoded. Try a PCM WAV or MP3 file.",
    );
  }
  if (
    buffer.duration > 30 ||
    buffer.duration < 0.02 ||
    buffer.numberOfChannels > 2
  )
    throw new Error(
      "Use mono or stereo clips between 0.02 and 30 seconds long.",
    );
  return buffer;
}
export async function validatePackAudio(
  pack: StoredPack,
  context: BaseAudioContext,
): Promise<Map<string, AudioBuffer>> {
  validateManifest(pack.manifest);
  if (
    Object.values(pack.assets).reduce((n, b) => n + b.size, 0) > MAX_PACK_BYTES
  )
    throw new Error("A sound pack must be smaller than 80 MB.");
  const buffers = new Map<string, AudioBuffer>();
  // Decode sequentially to bound transient memory on iPhone.
  for (const s of Object.values(pack.manifest.samples)) {
    if (!pack.assets[s.file]) throw new Error(`Missing audio: ${s.file}`);
    let buffer = buffers.get(s.file);
    if (!buffer) {
      buffer = await decodeAsset(pack.assets[s.file], context);
      buffers.set(s.file, buffer);
    }
    if (s.end > buffer.duration + 0.002)
      throw new Error(`Trim points exceed the length of ${s.file}.`);
  }
  return buffers;
}
export async function exportPack(pack: StoredPack): Promise<Blob> {
  validateManifest(pack.manifest);
  const files: Record<string, Uint8Array> = {
    "pack.json": strToU8(JSON.stringify(pack.manifest, null, 2)),
  };
  for (const s of Object.values(pack.manifest.samples)) {
    if (!pack.assets[s.file]) throw new Error("A sound file is missing.");
    files[s.file] = new Uint8Array(await pack.assets[s.file].arrayBuffer());
  }
  return new Blob([zipSync(files, { level: 0 })], { type: "application/zip" });
}
export async function importPack(file: File): Promise<StoredPack> {
  if (file.size > MAX_PACK_BYTES)
    throw new Error("A sound pack must be smaller than 80 MB.");
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter(entry) {
        if (
          entry.name !== "pack.json" &&
          !/^assets\/[a-zA-Z0-9_.-]+\.(wav|mp3)$/i.test(entry.name)
        )
          return false;
        if (
          entry.originalSize >
          (entry.name === "pack.json" ? 64000 : MAX_FILE_BYTES)
        )
          throw new Error("Oversized file");
        total += entry.originalSize;
        if (total > MAX_PACK_BYTES) throw new Error("Oversized pack");
        return true;
      },
    });
  } catch {
    throw new Error("Invalid ZIP or pack exceeds the import limits.");
  }
  if (!files["pack.json"])
    throw new Error("This ZIP needs a pack.json manifest.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(files["pack.json"]));
  } catch {
    throw new Error("The pack manifest is not valid JSON.");
  }
  const manifest = structuredClone(validateManifest(parsed));
  manifest.id = crypto.randomUUID(); // Import as a new pack; never overwrite a user's existing work.
  const assets: StoredPack["assets"] = {};
  for (const s of Object.values(manifest.samples)) {
    if (!files[s.file]) throw new Error(`Missing sound file: ${s.file}`);
    assets[s.file] = new Blob([files[s.file]], {
      type: s.file.endsWith(".mp3") ? "audio/mpeg" : "audio/wav",
    });
  }
  return { manifest, assets };
}
export function cleanAssets(pack: StoredPack): StoredPack {
  const used = new Set(Object.values(pack.manifest.samples).map((s) => s.file));
  return {
    manifest: pack.manifest,
    assets: Object.fromEntries(
      Object.entries(pack.assets).filter(([file]) => used.has(file)),
    ),
  };
}
export const isLoop = (role: string) =>
  LOOP_ROLES.includes(role as (typeof LOOP_ROLES)[number]);
