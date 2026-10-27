# GolfLarp

A mobile-first, installable engine-sound app for golf carts. Displays GPS speed and turns movement into a sampled engine soundtrack with five virtual gears, turbo spool and discharge, shifting, idle and overrun. Includes an offline default pack and a sound workshop.

## Run in Docker

```sh
docker compose up -d --build
```

The image serves **HTTP on port 8080** using unprivileged Nginx. The example Compose file binds `127.0.0.1:8080` for a reverse proxy running on the host. There is no TLS or certificate management in this image. Configure your existing reverse proxy to forward a public HTTPS origin to `http://127.0.0.1:8080`. If the proxy runs in Docker, attach it to the same Docker network and forward to `http://golflarp:8080`; adjust the Compose networking and remove the host port binding as appropriate.

```sh
docker build -t golflarp .
docker run --rm -p 127.0.0.1:8080:8080 golflarp
curl http://127.0.0.1:8080/healthz
```

Public HTTPS is required for GPS, motion permissions, service workers, and installation. Opening an ordinary `http://192.168.…` address on an iPhone will not enable these features. Forward the entire origin at `/`; subpath deployments are not configured. No WebSockets, database, application backend, server volumes, or API keys are needed. Existing reverse proxies should avoid caching `index.html`, `sw.js`, or `manifest.webmanifest` and must allow geolocation, accelerometer, gyroscope, and screen-wake-lock for the app’s own origin. Don’t embed the app in an iframe.

Keep the same public origin for upgrades: custom packs belong to that browser’s storage for that origin. Updating the container does not touch them. Hashed JS/CSS is immutable; service-worker, HTML, manifest, and sound update checks remain enabled. A waiting app update is offered only while stopped and outside the editor.

## Use on iPhone

1. Open the HTTPS address in Safari once online; wait for the default assets to cache.
2. Use **Share → Add to Home Screen** (Share may be inside More). Enable **Open as Web App** if shown, then Add. The in-app install guide explains the flow. iOS does not provide the same programmatic install prompt as Chromium.
3. Pair your speaker using iOS audio settings, mount the phone securely, and tap **Start engine**. Allow location and motion when requested. Audio starts from this explicit tap. The app requests a playback audio session on supported iPhones so Silent Mode does not mute the engine. Device media volume and the selected speaker still control the output.
4. Hold the cart still for roughly three seconds, then gently accelerate straight ahead. Calibration instructions disappear when the forward direction has been learned. GPS speed works during calibration. Use Recalibrate while stopped if you move the phone.
5. Leave GolfLarp visible. Switching apps, locking the phone, or an audio interruption pauses the engine; tap Resume after returning. Screen wake lock is requested while running if enabled.

Target: iOS/Safari 18.4+; Android/desktop browsers are supported where their APIs are available. Home Screen wake lock requires iOS 18.4+. Browser policies, low power mode, calls, and audio routes can affect playback or keep-awake; screen wake lock is best effort. Bluetooth adds device-dependent latency; output routing is controlled by iOS, not by the app. No microphone access is used.

**Demo mode** needs no GPS or motion permissions. Start, then adjust target speed and throttle to audition gears and effects. Speed transitions are smoothed. The default top speed of **25 mph** is configurable in Settings, in MPH or KM/H. It scales virtual gearing rather than capping measured speed. Set **0–25 mph time** (1–120 seconds; default 10) to your cart’s full-throttle acceleration time. Live throttle is estimated relative to the average acceleration of 25 mph divided by that time, with a small cruising load and zero load on strong deceleration. It cannot distinguish hills, drag, and actual pedal position. Demo throttle remains a direct manual control.

Speed is an estimate rather than a vehicle instrument. GPS is the speed anchor. After mounting calibration learns the forward direction, the accelerometer predicts speed changes between GPS fixes, updating both the speed display and engine RPM. Each accepted GPS fix corrects 65% of the prediction error; a measured stop resets speed to zero. Prediction is limited to within 2 m/s of the GPS reference, with a small acceleration deadband to suppress residual vibration. Missing motion events, turns, impacts, or a moved phone fall back to GPS, and motion prediction resumes after fresh valid readings and a GPS reference. Poor accuracy, large jumps, and stale readings are rejected. Null native speed falls back to position differences when sufficiently accurate, using up to five seconds of fixes so slow travel can exceed GPS uncertainty. This fallback can lag changes in speed and stopping by several seconds. After three seconds without valid GPS, speed becomes unavailable and audio returns to idle. There is no long-term accelerometer integration. RPM, gears, throttle, and boost are simulated; there is no connection to actual pedal or vehicle telemetry.

## Sound workshop and persistent library

Garage includes **Club Sport**, ready to use. Customize a copy or create a new engine. Import WAV/MP3 files from the iPhone Files picker and assign idle, low/mid/high RPM, coasting, startup/shutdown, shifts, spool, and discharge layers. Set trim/loop points, reference RPM, gain, idle/redline, turbo enablement, name, description, and credits. Preview individual layers. An idle layer and at least one driving RPM layer are required. Optional shift, startup, shutdown, and discharge effects have generated fallbacks. Turbo spool has a synthesized fallback.

Use stable engine recordings for RPM loops, with their actual recorded RPM as the reference where known. Pitch is modulated by virtual RPM and adjacent beds crossfade. A short overlap smooths loop boundaries. This is not a granular resynthesis tool or an automatic engine classifier.

Audio blobs and manifests are saved atomically in **IndexedDB** and restored across reloads, browser restarts, and offline launches. Users do **not** re-upload sounds each session. The app requests persistent storage and offers the request in Settings. Browsers can deny persistence, evict storage, or clear it on user request. Private Browsing, different Safari profiles, a different origin, and another device have separate storage. Export ZIP backups to avoid losing custom packs. Assets remain on-device and never upload to the Docker server.

Limits: WAV/MP3, mono/stereo, 0.02–30 seconds per clip, up to 12 MB per file and 80 MB per pack. Use PCM WAV or MP3 for broad iPhone decoding support. Save/import validates assets and leaves existing packs intact on failure. Delete asks for confirmation. Imported packs receive a new ID to avoid overwriting another engine.

### Portable pack format (v1)

An exported `.golflarp.zip` contains `pack.json` plus referenced files beneath `assets/`. See [types](src/types.ts) and [validation](src/packs.ts) for the full contract. Unknown versions and unsafe asset paths are rejected. Audio files are embedded rather than referenced by remote URLs.

```json
{
  "version": 1,
  "id": "your-engine-id",
  "name": "My engine",
  "description": "A custom soundtrack",
  "credits": "Creator and source/license details",
  "engine": { "idleRpm": 950, "redlineRpm": 7000, "turbo": true },
  "samples": {
    "idle": {
      "file": "assets/idle.wav",
      "baseRpm": 950,
      "gain": 0.8,
      "start": 0,
      "end": 3,
      "loopStart": 0,
      "loopEnd": 3
    },
    "low": {
      "file": "assets/drive.wav",
      "baseRpm": 2500,
      "gain": 0.8,
      "start": 0,
      "end": 4,
      "loopStart": 0,
      "loopEnd": 4
    }
  }
}
```

All timestamps are seconds; loop points must be within the trim. Reference RPM must be positive, gain is 0–2, and redline must exceed idle by more than 500 RPM. Additional roles: `mid`, `high`, `coast`, `startup`, `shutdown`, `upshift`, `downshift`, `blowoff`, `turbo`. Export retains credits and all referenced audio. Do not distribute recordings you lack rights to share.

## Development and checks

Node 24 recommended.

```sh
npm ci
npm run dev
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

The production build precaches the app, icons, credits, and the complete default pack (roughly 0.7 MB total). Unit tests exercise GPS filtering, null-speed fallback, jitter, stale data, gear scaling/hysteresis, boost cooldowns, and pack validation/round trips. Playwright checks mobile layout, demo playback, live GPS injection, saved settings, custom blob persistence, export/import, and offline relaunch. Playwright starts the production preview on port 4173, so build first.

Real-device acceptance still requires an iPhone: Safari and installed mode, permission grant/denial, mounting calibration on a low-speed drive, stop/start and calls, speaker/Bluetooth playback, loop listening review, wake-lock behavior, and offline reopening. Browser emulation does not verify iOS sensor policies or physical audio latency. A denied location permission must be enabled for the site in Safari/system settings before retrying.

## Default recordings and reproduction

Bundled assets are actual audio files and require no runtime downloads from third parties. [Full credits](public/CREDITS.md) identify the CC BY 3.0 qubodup engine recording, source file, edits, and links. The default pack uses this one continuous recording for both idle and driving at the same reference RPM, trim points and gain. Throttle changes load through gain and filtering; it does not crossfade different car recordings or a separate coast sample. Startup, shutdown, shifts and turbo effects are generated in code. The application code is MIT; audio retains its respective licenses. Preset reference RPMs are sound-design tuning, not independently measured vehicle RPMs.

To reproduce the bundled edits, download and extract the engine-loop archive linked in the credits to a temporary directory, preserving the `engine-loop/` directory. Then run:

```sh
python3 scripts/prepare-audio.py /path/to/extracted-sources
```

Requires ffmpeg. Only the prepared excerpts ship in the image; the full upstream recordings are not included. App icons are original SVG artwork rasterized with `rsvg-convert`.
