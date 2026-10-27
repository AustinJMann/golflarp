import { expect, test } from "@playwright/test";

test("dashboard, demo audio, settings and install guidance", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (
      destination: AudioNode | AudioParam,
      ...args: number[]
    ) {
      if (destination instanceof AudioDestinationNode) {
        const analyser = (this.context as AudioContext).createAnalyser();
        analyser.fftSize = 8192;
        Reflect.apply(connect, this, [analyser]);
        Reflect.apply(connect, analyser, [destination]);
        (window as unknown as { engineOutput: AnalyserNode }).engineOutput =
          analyser;
        return destination;
      }
      return Reflect.apply(connect, this, [destination, ...args]);
    } as typeof AudioNode.prototype.connect;
  });
  await page.goto("/");
  await expect(page.getByLabel("Speedometer", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Demo mode" }).click();
  await page.getByRole("button", { name: "Start engine" }).click();
  await expect(page.getByRole("button", { name: "Stop engine" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop engine" }),
  ).toBeInViewport();
  await page.getByLabel("Demo target speed").fill("8");
  await expect(page.getByLabel("Current speed 18 mph")).toBeVisible({
    timeout: 10000,
  });
  await page.waitForTimeout(1000); // Allow speed and RPM to settle before changing only load.
  const rpm = async () =>
    Number(
      (await page.locator(".drive-reading").innerText())
        .split("·")[1]
        .replace(/[^0-9]/g, ""),
    );
  const beforeThrottle = await rpm();
  const energy = () =>
    page.evaluate(async () => {
      const analyser = (window as unknown as { engineOutput: AnalyserNode })
        .engineOutput;
      let sum = 0;
      for (let i = 0; i < 4; i++) {
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        sum += data.reduce((n, x) => n + x * x, 0) / data.length;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return Math.sqrt(sum / 4);
    });
  const beforeEnergy = await energy();
  expect(beforeEnergy).toBeGreaterThan(0.0001);
  await expect(page.getByLabel("Master volume", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Mute", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unmute", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Unmute", exact: true }).click();
  await page.getByLabel("Demo throttle").fill("1");
  await page.waitForTimeout(500);
  expect(Math.abs((await rpm()) - beforeThrottle)).toBeLessThan(3);
  expect(await energy()).toBeGreaterThan(beforeEnergy * 1.1);
  await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
  await page.getByRole("button", { name: "Stop engine" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Vehicle top speed")).toHaveValue("25");
  await expect(page.getByLabel("0–25 mph time", { exact: true })).toHaveValue(
    "10",
  );
  await page.getByLabel("0–25 mph time", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Save time", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("between 1 and 120");
  await page.getByLabel("0–25 mph time", { exact: true }).fill("8.5");
  await page.getByRole("button", { name: "Save time", exact: true }).click();
  await page.getByLabel("Vehicle top speed").fill("18");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Vehicle top speed")).toHaveValue("18");
  await expect(page.getByLabel("0–25 mph time", { exact: true })).toHaveValue(
    "8.5",
  );
  await page
    .getByRole("button", { name: "Add to Home Screen", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Home Screen");
  expect(errors).toEqual([]);
});

test("sound editing persists blobs, exports and imports packs, and works offline", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.getByRole("button", { name: "Garage", exact: true }).click();
  await page.getByRole("button", { name: "Customize a copy" }).click();
  await expect(
    page.getByRole("heading", { name: "Engine workshop" }),
  ).toBeVisible();
  await page.getByLabel("Engine name").fill("Weekend turbo");
  await page
    .getByRole("button", { name: "Save engine to this device" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Weekend turbo" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Garage", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Weekend turbo" }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Weekend turbo", exact: true })
    .click();
  const download = await downloadPromise;
  await page
    .locator("input[type=file]")
    .setInputFiles((await download.path())!);
  await expect(
    page.getByRole("heading", { name: "Weekend turbo" }),
  ).toHaveCount(2);
  // Offline after the first online install must retain both shell and audio.
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel("Speedometer", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Demo mode" }).click();
  await page.getByRole("button", { name: "Start engine" }).click();
  await expect(page.getByRole("button", { name: "Stop engine" })).toBeVisible();
  await page.getByRole("button", { name: "Stop engine" }).click();
  await page.getByRole("button", { name: "Garage", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Weekend turbo" }),
  ).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("live mode consumes GPS updates and releases tracking on stop", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let success: PositionCallback;
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition(callback: PositionCallback) {
          success = callback;
          return 42;
        },
        clearWatch(id: number) {
          (window as unknown as Record<string, unknown>).clearedWatch = id;
        },
      },
    });
    (window as unknown as Record<string, unknown>).pushSpeed = (
      speed: number,
    ) =>
      success({
        timestamp: Date.now(),
        coords: {
          speed,
          latitude: 40,
          longitude: -74,
          accuracy: 5,
          altitude: null,
          altitudeAccuracy: null,
          heading: 0,
        },
      } as GeolocationPosition);
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Start engine" }).click();
  await expect(page.getByRole("button", { name: "Stop engine" })).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { pushSpeed: (n: number) => void }).pushSpeed(5),
  );
  await expect(page.getByLabel("Current speed 11 mph")).toBeVisible();
  await expect(page.getByLabel("Current speed — mph")).toBeVisible({
    timeout: 6000,
  });
  await page.getByRole("button", { name: "Stop engine" }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as Record<string, unknown>).clearedWatch,
    ),
  ).toBe(42);
});

test("individual audio uploads survive reload and a failed pack import", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Garage", exact: true }).click();
  await page.getByRole("button", { name: "Build an engine" }).click();
  await page.getByLabel("Engine name").fill("Pocket motor");
  await page
    .locator("input[type=file]")
    .setInputFiles("public/sounds/engine.wav");
  await expect(
    page.getByRole("button", { name: "Preview layer" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview layer" }).click();
  await page.getByRole("button", { name: "Stop preview" }).click();
  await page.getByLabel("Sound layer", { exact: true }).selectOption("low");
  await page
    .locator("input[type=file]")
    .setInputFiles("public/sounds/engine.wav");
  await expect(
    page.getByRole("button", { name: "Preview layer" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save engine to this device" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Pocket motor" }),
  ).toBeVisible();
  await page.locator("input[type=file]").setInputFiles({
    name: "broken.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("not a zip"),
  });
  await expect(page.getByRole("alert")).toContainText("Invalid ZIP");
  await expect(
    page.getByRole("heading", { name: "Pocket motor" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Garage", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit Pocket motor", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Preview layer" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview layer" }).click();
  await page.getByRole("button", { name: "Stop preview" }).click();
  await page.getByRole("button", { name: "Back to garage" }).click();
  await page
    .getByRole("button", { name: "Delete Pocket motor", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove engine", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Pocket motor" })).toHaveCount(
    0,
  );
});
