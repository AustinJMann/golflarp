# GolfLarp default audio — Club Sport

## Engine recording: qubodup

- Creator: qubodup (Iwan Gabovitch)
- Source: https://opengameart.org/content/car-engine-loop-96khz-4s
- Download: https://opengameart.org/sites/default/files/engine-loop.7z
- Original: `engine-loop/engine-loop-1-normalized.wav`
- License: Creative Commons Attribution 3.0 Unported (CC BY 3.0)
- License text: https://creativecommons.org/licenses/by/3.0/legalcode
- Output: `engine.wav` — one continuous 3.8-second excerpt, downmixed to mono, filtered, leveled and resampled to 44.1 kHz / 16-bit PCM.

The same recording, reference RPM, loop points and gain are assigned to both idle and driving roles. Playback remains phase-aligned and pitch-continuous through the role transition. There are no alternate car recordings or separate coast samples in this default pack. Runtime pitch follows virtual RPM; throttle increases gain and opens a low-pass filter to simulate engine load. The 2,600 reference RPM is an artistic tuning value, not independently measured vehicle RPM.

## Generated effects

Startup, shutdown, shifts, turbo airflow and discharge are generated in code. They use no recordings from other cars. The app overlaps loop boundaries and uses output compression and headroom.

Reproduce `engine.wav` using `scripts/prepare-audio.py`; see README.md. Application source is MIT licensed; the engine recording retains CC BY 3.0. Exported default packs retain attribution.
