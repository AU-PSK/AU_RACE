import type { Sfx } from "./race.js";

// Alle lyde syntetiseres med Web Audio, så der hverken skal hentes eller licenseres lydfiler.
// AudioContext må først oprettes efter et klik, derfor kaldes unlock() fra knapperne.

let context: AudioContext | null = null;
let master: GainNode | null = null;
let engine: {
  low: OscillatorNode;
  high: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  lfo: OscillatorNode;
  rattle: BiquadFilterNode;
  rattleGain: GainNode;
  squeal: AudioBufferSourceNode;
  squealGain: GainNode;
} | null = null;
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

  // Golfbil: dæmpet elektrisk summen. Rene toner (trekant + sinus) med en let svævende modulation
  // og en svag støjtone fra dækkene i stedet for forbrændingsslag.
  const gain = context.createGain();
  gain.gain.value = 0;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 1;
  filter.frequency.value = 900;
  const body = context.createBiquadFilter();
  body.type = "peaking";
  body.frequency.value = 400;
  body.gain.value = 4;
  const low = context.createOscillator();
  low.type = "triangle";
  const high = context.createOscillator();
  high.type = "sine";
  high.detune.value = 6;
  const highGain = context.createGain();
  highGain.gain.value = 0.35;

  // Let svævning i amplituden, så lyden føles levende uden at være ru.
  const pulse = context.createGain();
  pulse.gain.value = 0.95;
  const lfo = context.createOscillator();
  lfo.type = "sine";
  const lfoDepth = context.createGain();
  lfoDepth.gain.value = 0.04;
  lfo.connect(lfoDepth);
  lfoDepth.connect(pulse.gain);

  const buzz = context.createBufferSource();
  const noiseLength = context.sampleRate;
  const noiseBuffer = context.createBuffer(1, noiseLength, context.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseLength; i++) noiseData[i] = Math.random() * 2 - 1;
  buzz.buffer = noiseBuffer;
  buzz.loop = true;
  const rattle = context.createBiquadFilter();
  rattle.type = "bandpass";
  rattle.frequency.value = 2200;
  rattle.Q.value = 0.8;
  const rattleGain = context.createGain();
  rattleGain.gain.value = 0;

  // Dækhyl under drift: hvæsende støj med en let svingende tone, som kun høres, mens der drives.
  const squeal = context.createBufferSource();
  squeal.buffer = noiseBuffer;
  squeal.loop = true;
  const squealFilter = context.createBiquadFilter();
  squealFilter.type = "bandpass";
  squealFilter.frequency.value = 1500;
  squealFilter.Q.value = 9;
  const squealGain = context.createGain();
  squealGain.gain.value = 0;
  squeal.connect(squealFilter);
  squealFilter.connect(squealGain);
  squealGain.connect(master);

  low.connect(pulse);
  high.connect(highGain);
  highGain.connect(pulse);
  pulse.connect(filter);
  filter.connect(body);
  body.connect(gain);
  buzz.connect(rattle);
  rattle.connect(rattleGain);
  rattleGain.connect(gain);
  gain.connect(master);
  low.start();
  high.start();
  lfo.start();
  buzz.start();
  squeal.start();
  engine = { low, high, gain, filter, lfo, rattle, rattleGain, squeal, squealGain };
}

export function toggleMute(): boolean {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

/** Motorlyd efter fart. Kaldes ved hver tilstandsopdatering; silence=true slukker motoren. */
export function setEngine(speed: number, boosting: boolean, silence: boolean, drifting = false): void {
  if (!context || !engine) return;
  const now = context.currentTime;
  const ratio = Math.min(1.6, Math.max(0, speed) / 16);
  // Elmotor: dyb summen (~110 Hz) der stiger til ~500 Hz ved fuld fart.
  const base = 110 + ratio * 240 + (boosting ? 50 : 0);
  engine.low.frequency.setTargetAtTime(base, now, 0.09);
  engine.high.frequency.setTargetAtTime(base * 2, now, 0.09);
  engine.lfo.frequency.setTargetAtTime(4 + ratio * 4, now, 0.1);
  engine.filter.frequency.setTargetAtTime(600 + ratio * 1000, now, 0.1);
  engine.rattle.frequency.setTargetAtTime(1000 + ratio * 800, now, 0.1);
  engine.rattleGain.gain.setTargetAtTime(0.01 + ratio * 0.04, now, 0.1);
  engine.gain.gain.setTargetAtTime(silence ? 0 : 0.06 + ratio * 0.04, now, 0.12);

  const squealing = !silence && drifting && speed > 6;
  engine.squealGain.gain.setTargetAtTime(squealing ? 0.05 + ratio * 0.05 : 0, now, 0.06);
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
