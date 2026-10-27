import type { Sfx } from "./race.js";

// Alle lyde syntetiseres med Web Audio, så der hverken skal hentes eller licenseres lydfiler.
// AudioContext må først oprettes efter et klik, derfor kaldes unlock() fra knapperne.

let context: AudioContext | null = null;
let master: GainNode | null = null;
let engine: { low: OscillatorNode; high: OscillatorNode; gain: GainNode } | null = null;
let muted = false;

export function unlockAudio(): void {
  if (context) {
    if (context.state === "suspended") void context.resume();
    return;
  }
  try {
    context = new AudioContext();
  } catch {
    return;
  }
  master = context.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(context.destination);

  const gain = context.createGain();
  gain.gain.value = 0;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  const low = context.createOscillator();
  low.type = "sawtooth";
  const high = context.createOscillator();
  high.type = "square";
  low.connect(filter);
  high.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  low.start();
  high.start();
  engine = { low, high, gain };
}

export function toggleMute(): boolean {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

/** Motorlyd efter fart. Kaldes ved hver tilstandsopdatering; silence=true slukker motoren. */
export function setEngine(speed: number, boosting: boolean, silence: boolean): void {
  if (!context || !engine) return;
  const now = context.currentTime;
  const ratio = Math.min(1.6, Math.max(0, speed) / 16);
  engine.low.frequency.setTargetAtTime(48 + ratio * 70 + (boosting ? 18 : 0), now, 0.08);
  engine.high.frequency.setTargetAtTime(96 + ratio * 140 + (boosting ? 30 : 0), now, 0.08);
  engine.gain.gain.setTargetAtTime(silence ? 0 : 0.05 + ratio * 0.05, now, 0.12);
}

function tone(frequency: number, start: number, length: number, type: OscillatorType, volume: number, slideTo?: number): void {
  if (!context || !master) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const at = context.currentTime + start;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, at);
  if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, at + length);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  oscillator.connect(gain);
  gain.connect(master);
  oscillator.start(at);
  oscillator.stop(at + length + 0.05);
}

function noise(start: number, length: number, volume: number, frequency: number): void {
  if (!context || !master) return;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * length), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const source = context.createBufferSource();
  source.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = frequency;
  const gain = context.createGain();
  gain.gain.value = volume;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  source.start(context.currentTime + start);
}

export function playBeep(go: boolean): void {
  if (go) tone(880, 0, 0.55, "square", 0.22);
  else tone(440, 0, 0.18, "square", 0.18);
}

export function playSfx(sfx: Sfx): void {
  switch (sfx) {
    case "item":
      for (let i = 0; i < 6; i++) tone(523 * 2 ** ((i % 3) / 3 + Math.floor(i / 3) / 2), i * 0.08, 0.1, "triangle", 0.2);
      tone(1046, 0.5, 0.25, "triangle", 0.22);
      break;
    case "boost":
      noise(0, 0.6, 0.5, 1800);
      tone(220, 0, 0.5, "sawtooth", 0.12, 660);
      break;
    case "hit":
      noise(0, 0.35, 0.8, 500);
      tone(300, 0, 0.45, "square", 0.2, 70);
      break;
    case "lap":
      tone(660, 0, 0.12, "square", 0.16);
      tone(990, 0.12, 0.2, "square", 0.16);
      break;
    case "fall":
      tone(600, 0, 0.7, "sine", 0.25, 80);
      noise(0.5, 0.3, 0.4, 900);
      break;
    case "finish":
      [523, 659, 784, 1046].forEach((frequency, i) => tone(frequency, i * 0.13, 0.3, "triangle", 0.22));
      break;
  }
}
