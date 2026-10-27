import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  DEFAULT_PACK,
  exportPack,
  importPack,
  validateManifest,
} from "./packs";
describe("portable sound packs", () => {
  it("keeps the default engine on one continuous recording and pitch reference", () => {
    const samples = Object.values(DEFAULT_PACK.samples);
    expect(samples.length).toBeGreaterThanOrEqual(2);
    expect(new Set(samples.map((s) => s.file)).size).toBe(1);
    expect(
      new Set(
        samples.map(
          (s) => `${s.baseRpm}:${s.loopStart}:${s.loopEnd}:${s.gain}`,
        ),
      ).size,
    ).toBe(1);
    expect(DEFAULT_PACK.samples.coast).toBeUndefined();
  });
  it("round trips audio, settings, and credits without reusing the original ID", async () => {
    const manifest = structuredClone(DEFAULT_PACK);
    const assets = Object.fromEntries(
      Object.values(manifest.samples).map((s) => [
        s.file,
        new Blob(["test wav bytes"]),
      ]),
    );
    const exported = await exportPack({ manifest, assets });
    const imported = await importPack(new File([exported], "pack.zip"));
    expect(imported.manifest.name).toBe(manifest.name);
    expect(imported.manifest.credits).toBe(manifest.credits);
    expect(imported.manifest.id).not.toBe(manifest.id);
    expect(await imported.assets[manifest.samples.idle!.file].text()).toBe(
      "test wav bytes",
    );
  });
  it("rejects future versions, missing required layers, and inverted loops", () => {
    const pack = structuredClone(DEFAULT_PACK);
    pack.version = 2 as 1;
    expect(() => validateManifest(pack)).toThrow("version");
    pack.version = 1;
    pack.samples.idle!.loopEnd = 0;
    expect(() => validateManifest(pack)).toThrow("loop");
    delete pack.samples.idle;
    expect(() => validateManifest(pack)).toThrow("idle");
  });
  it("rejects missing assets, unsafe asset paths, and corrupt ZIPs", async () => {
    const pack = structuredClone(DEFAULT_PACK);
    const zip = zipSync({ "pack.json": strToU8(JSON.stringify(pack)) });
    await expect(importPack(new File([zip], "pack.zip"))).rejects.toThrow(
      "Missing sound",
    );
    pack.samples.idle!.file = "../secret.wav";
    expect(() => validateManifest(pack)).toThrow("path");
    await expect(
      importPack(new File(["broken"], "broken.zip")),
    ).rejects.toThrow("Invalid ZIP");
  });
});
