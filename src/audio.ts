import {
  clamp,
  type EngineFrame,
  type Role,
  type Sample,
  type StoredPack,
} from "./types";
import { isLoop, validatePackAudio } from "./packs";

type Voice = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  role: Role;
  sample: Sample;
};
export class AudioEngine {
  readonly context: AudioContext;
  private master: GainNode;
  private drive: GainNode;
  private engineFilter: BiquadFilterNode;
  private voices: Voice[] = [];
  private pack?: StoredPack;
  private buffers = new Map<string, AudioBuffer>();
  private previewStop?: () => void;
  private transientStops = new Set<() => void>();
  private lastEvent = new Map<string, number>();
  private playing = false;
  constructor() {
    this.context = new AudioContext({ latencyHint: "interactive" });
    this.master = this.context.createGain();
    this.master.gain.value = 0;
    this.drive = this.context.createGain();
    this.engineFilter = this.context.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.Q.value = 0.6;
    this.engineFilter.frequency.value = 1200;
    this.engineFilter.connect(this.drive);
    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 8;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;
    // Leave headroom before the compressor and at the destination.
    const headroom = this.context.createGain();
    headroom.gain.value = 0.6;
    this.drive.connect(compressor);
    compressor.connect(headroom);
    headroom.connect(this.master);
    this.master.connect(this.context.destination);
  }
  unlock() {
    // iOS otherwise treats Web Audio as ambient audio, which obeys Silent Mode.
    // Request the session during the tap, before resume or asynchronous loading.
    const session = (
      navigator as Navigator & { audioSession?: { type: string } }
    ).audioSession;
    if (session) {
      try {
        session.type = "playback";
      } catch {
        // Other browsers may expose a session without allowing this category.
      }
    }
    // Activate the output during the gesture even while engine assets load.
    const primer = this.context.createBufferSource();
    primer.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
    primer.connect(this.master);
    primer.onended = () => primer.disconnect();
    primer.start();
    return this.context.resume();
  }
  setVolume(volume: number) {
    this.master.gain.setTargetAtTime(
      clamp(volume, 0, 1),
      this.context.currentTime,
      0.035,
    );
  }
  async load(pack: StoredPack) {
    this.stop();
    this.buffers = await validatePackAudio(pack, this.context);
    this.pack = pack;
  }
  start() {
    this.stop();
    if (!this.pack) throw new Error("Select an engine first.");
    const now = this.context.currentTime;
    for (const [role, s] of Object.entries(this.pack.manifest.samples)) {
      if (!isLoop(role)) continue;
      // Turn arbitrary trim boundaries into seamless loops with a short overlap.
      const original = this.buffers.get(s.file)!;
      const voice = this.voice(
        role as Role,
        s,
        true,
        this.loopBuffer(original, s.loopStart, s.loopEnd),
      );
      voice.source.loopStart = 0;
      voice.source.loopEnd = voice.source.buffer!.duration;
      voice.source.start(now);
      this.voices.push(voice);
    }
    this.playing = true;
    this.effect("startup");
  }
  private loopBuffer(
    original: AudioBuffer,
    start: number,
    end: number,
  ): AudioBuffer {
    const rate = original.sampleRate;
    const frames = Math.floor((end - start) * rate);
    const overlap = Math.min(Math.floor(rate * 0.025), Math.floor(frames / 4));
    const length = frames - overlap;
    const buffer = this.context.createBuffer(
      original.numberOfChannels,
      length,
      rate,
    );
    const offset = Math.floor(start * rate);
    for (let c = 0; c < original.numberOfChannels; c++) {
      const input = original.getChannelData(c);
      const output = buffer.getChannelData(c);
      output.set(input.subarray(offset + overlap, offset + frames));
      for (let i = 0; i < overlap; i++) {
        const t = i / overlap;
        output[length - overlap + i] =
          input[offset + frames - overlap + i] * (1 - t) +
          input[offset + i] * t;
      }
    }
    return buffer;
  }
  private voice(
    role: Role,
    s: Sample,
    loop: boolean,
    buffer?: AudioBuffer,
  ): Voice {
    const source = this.context.createBufferSource();
    source.buffer = buffer ?? this.buffers.get(s.file)!;
    source.loop = loop;
    const gain = this.context.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(loop && role !== "turbo" ? this.engineFilter : this.drive);
    return { source, gain, role, sample: s };
  }
  update(frame: EngineFrame) {
    if (!this.pack) return;
    const now = this.context.currentTime;
    this.engineFilter.frequency.setTargetAtTime(
      clamp(850 + frame.rpm * 0.22 + frame.throttle * 3400, 800, 8000),
      now,
      0.06,
    );
    const loops = this.voices
      .filter((v) => ["idle", "low", "mid", "high"].includes(v.role))
      .sort((a, b) => a.sample.baseRpm - b.sample.baseRpm);
    const weights = new Map<Voice, number>();
    if (loops.length) {
      if (frame.rpm <= loops[0].sample.baseRpm) weights.set(loops[0], 1);
      else if (frame.rpm >= loops[loops.length - 1].sample.baseRpm)
        weights.set(loops[loops.length - 1], 1);
      else {
        for (let i = 1; i < loops.length; i++)
          if (frame.rpm <= loops[i].sample.baseRpm) {
            const mix = clamp(
              (frame.rpm - loops[i - 1].sample.baseRpm) /
                Math.max(
                  1,
                  loops[i].sample.baseRpm - loops[i - 1].sample.baseRpm,
                ),
              0,
              1,
            );
            weights.set(loops[i - 1], Math.cos((mix * Math.PI) / 2));
            weights.set(loops[i], Math.sin((mix * Math.PI) / 2));
            break;
          }
      }
    }
    const coast = this.pack.manifest.samples.coast
      ? (1 - frame.throttle) * clamp((frame.rpm - 1300) / 1200, 0, 1) * 0.65
      : 0;
    for (const voice of this.voices) {
      let level =
        (weights.get(voice) ?? 0) * (1 - coast) * (0.4 + frame.throttle * 0.6);
      if (voice.role === "coast") level = coast * 0.6;
      if (voice.role === "turbo") level = frame.boost * 0.45;
      voice.gain.gain.setTargetAtTime(
        level * voice.sample.gain * (frame.shifting ? 0.35 : 1),
        now,
        0.04,
      );
      voice.source.playbackRate.setTargetAtTime(
        clamp(frame.rpm / voice.sample.baseRpm, 0.35, 3.5),
        now,
        0.035,
      );
    }
    for (const event of frame.events) this.effect(event);
    // A quiet synthesized spool fills the optional turbo slot without replacing engine recordings.
    if (this.pack.manifest.engine.turbo && !this.pack.manifest.samples.turbo)
      this.updateSpool(frame.boost, frame.rpm);
  }
  private spool?: {
    source: AudioBufferSourceNode;
    filter: BiquadFilterNode;
    gain: GainNode;
  };
  private updateSpool(boost: number, rpm: number) {
    if (!this.spool) {
      // Broadband airflow stays subtle under load, unlike a pure sine whistle.
      const buffer = this.context.createBuffer(
        1,
        this.context.sampleRate * 2,
        this.context.sampleRate,
      );
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++)
        samples[i] = Math.random() * 2 - 1;
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = this.context.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.value = 0.7;
      filter.frequency.value = 650;
      const gain = this.context.createGain();
      gain.gain.value = 0;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.drive);
      source.start();
      this.spool = { source, filter, gain };
    }
    this.spool.filter.frequency.setTargetAtTime(
      650 + rpm * 0.1,
      this.context.currentTime,
      0.1,
    );
    this.spool.gain.gain.setTargetAtTime(
      boost * 0.018,
      this.context.currentTime,
      0.1,
    );
  }
  effect(role: Role) {
    const now = this.context.currentTime;
    if (now - (this.lastEvent.get(role) ?? -10) < 0.18) return;
    this.lastEvent.set(role, now);
    const s = this.pack?.manifest.samples[role];
    if (s) {
      const voice = this.voice(role, s, false);
      voice.gain.gain.setValueAtTime(0, now);
      voice.gain.gain.linearRampToValueAtTime(s.gain * 0.65, now + 0.008);
      const duration = s.end - s.start;
      voice.gain.gain.setValueAtTime(
        s.gain * 0.65,
        now + Math.max(0.01, duration - 0.04),
      );
      voice.gain.gain.linearRampToValueAtTime(0, now + duration);
      const stop = () => {
        try {
          voice.source.stop();
        } catch {
          /* already ended */
        }
        voice.source.disconnect();
        voice.gain.disconnect();
      };
      this.transientStops.add(stop);
      voice.source.onended = () => {
        voice.source.disconnect();
        voice.gain.disconnect();
        this.transientStops.delete(stop);
      };
      voice.source.start(now, s.start, duration);
    } else this.generatedEffect(role);
  }
  private generatedEffect(role: Role) {
    const now = this.context.currentTime;
    const duration =
      role === "blowoff"
        ? 0.55
        : role === "startup"
          ? 0.65
          : role === "shutdown"
            ? 0.4
            : 0.12;
    const buffer = this.context.createBuffer(
      1,
      Math.ceil(this.context.sampleRate * duration),
      this.context.sampleRate,
    );
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      const t = i / this.context.sampleRate;
      samples[i] =
        (role === "blowoff"
          ? Math.random() * 2 - 1
          : Math.sin(
              t * 2 * Math.PI * (role === "startup" ? 50 + t * 100 : 90),
            )) *
        Math.exp(-t * (role === "blowoff" ? 8 : 14)) *
        0.3;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const filter = this.context.createBiquadFilter();
    filter.type = role === "blowoff" ? "bandpass" : "lowpass";
    filter.frequency.value = role === "blowoff" ? 2400 : 700;
    filter.Q.value = 0.6;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.6, now + 0.005);
    gain.gain.setTargetAtTime(0, now + duration * 0.65, 0.03);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.drive);
    const stop = () => {
      try {
        source.stop();
      } catch {
        /* already ended */
      }
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    this.transientStops.add(stop);
    source.onended = () => {
      stop();
      this.transientStops.delete(stop);
    };
    source.start(now);
  }
  preview(buffer: AudioBuffer, sample: Sample, loop: boolean) {
    this.stopPreview();
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const gain = this.context.createGain();
    gain.gain.value = sample.gain * 0.6;
    source.loop = loop;
    source.loopStart = sample.loopStart;
    source.loopEnd = sample.loopEnd;
    source.connect(gain);
    gain.connect(this.drive);
    source.start(
      0,
      loop ? sample.loopStart : sample.start,
      loop ? undefined : sample.end - sample.start,
    );
    this.previewStop = () => {
      try {
        source.stop();
      } catch {
        /* ended */
      }
      source.disconnect();
      gain.disconnect();
    };
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
  }
  stopPreview() {
    this.previewStop?.();
    this.previewStop = undefined;
  }
  finish() {
    const wasPlaying = this.playing;
    this.stop();
    if (wasPlaying) this.effect("shutdown");
  }
  stop() {
    this.playing = false;
    this.stopPreview();
    for (const v of this.voices) {
      const now = this.context.currentTime;
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0, now, 0.008);
      v.source.onended = () => {
        v.source.disconnect();
        v.gain.disconnect();
      };
      v.source.stop(now + 0.045);
    }
    this.voices = [];
    for (const stop of this.transientStops) stop();
    this.transientStops.clear();
    if (this.spool) {
      this.spool.source.stop();
      this.spool.source.disconnect();
      this.spool.filter.disconnect();
      this.spool.gain.disconnect();
      this.spool = undefined;
    }
  }
  async close() {
    this.stop();
    await this.context.close();
  }
}
