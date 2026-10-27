import { openDB, type DBSchema } from "idb";
import {
  DEFAULT_SETTINGS,
  clamp,
  type Settings,
  type StoredPack,
} from "./types";

interface LibraryDB extends DBSchema {
  packs: { key: string; value: StoredPack };
  settings: { key: string; value: Settings };
}
const db = () =>
  openDB<LibraryDB>("golflarp", 1, {
    upgrade(database) {
      database.createObjectStore("packs");
      database.createObjectStore("settings");
    },
  });
export async function listPacks() {
  return (await db()).getAll("packs");
}
export async function savePack(pack: StoredPack) {
  await (await db()).put("packs", pack, pack.manifest.id);
}
export async function deletePack(id: string) {
  await (await db()).delete("packs", id);
}
export async function loadSettings(): Promise<Settings> {
  const saved = await (await db()).get("settings", "preferences");
  return saved
    ? {
        unit: saved.unit === "kmh" ? "kmh" : "mph",
        topSpeedMps: Number.isFinite(saved.topSpeedMps)
          ? clamp(saved.topSpeedMps, 1, 65)
          : DEFAULT_SETTINGS.topSpeedMps,
        zeroTo25Seconds:
          Number.isFinite(saved.zeroTo25Seconds) &&
          saved.zeroTo25Seconds >= 1 &&
          saved.zeroTo25Seconds <= 120
            ? saved.zeroTo25Seconds
            : DEFAULT_SETTINGS.zeroTo25Seconds,
        packId:
          typeof saved.packId === "string"
            ? saved.packId
            : DEFAULT_SETTINGS.packId,
        keepAwake:
          typeof saved.keepAwake === "boolean" ? saved.keepAwake : true,
      }
    : DEFAULT_SETTINGS;
}
export async function saveSettings(settings: Settings) {
  await (await db()).put("settings", settings, "preferences");
}
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  return (await navigator.storage.persisted()) || navigator.storage.persist();
}
