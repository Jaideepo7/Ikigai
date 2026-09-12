/**
 * WebAudio sound. SFX are synthesized (no files needed). Music plays /assets/audio/lofi.mp3 if the team drops
 * one in; otherwise a soft generated pad loops so the toggle still does something.
 */
let ctx: AudioContext | null = null;
let musicOn = true, sfxOn = true;
let musicEl: HTMLAudioElement | null = null;
let pad: { gain: GainNode; nodes: AudioNode[] } | null = null;

function ac() { return (ctx ??= new AudioContext()); }
export function unlock() { if (ctx?.state === 'suspended') ctx.resume(); }

function blip(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.08, slide = 0) {
  if (!sfxOn) return;
  const a = ac(), o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, a.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + dur);
}
export const sfx = {
  step: () => blip(140, 0.05, 'triangle', 0.03, -60),
  click: () => blip(660, 0.06, 'square', 0.04),
  plant: () => { blip(330, 0.12, 'triangle', 0.08, 200); setTimeout(() => blip(520, 0.15, 'triangle', 0.06, 200), 90); },
  coin: () => { blip(880, 0.08, 'square', 0.05); setTimeout(() => blip(1320, 0.14, 'square', 0.05), 70); },
  levelUp: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.2, 'square', 0.06), i * 110)),
  error: () => blip(160, 0.2, 'sawtooth', 0.05, -60),
  spin: () => blip(300 + Math.random() * 200, 0.04, 'square', 0.03),
  chime: () => [784, 988, 1175].forEach((f, i) => setTimeout(() => blip(f, 0.3, 'sine', 0.08), i * 150)),
};

async function startPad() {
  const a = ac(), gain = a.createGain();
  gain.gain.value = 0.05;
  const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
  const nodes: AudioNode[] = [];
  // ponytail: a slow I-vi-IV-V pad in C. Real lofi = drop lofi.mp3 in public/assets/audio.
  const chords = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];
  chords.forEach((chord, ci) => chord.forEach((f) => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'triangle'; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 12;
    const lfo = a.createOscillator(), lg = a.createGain();
    lfo.frequency.value = 1 / 16; lg.gain.value = 0.5;
    const t0 = a.currentTime;
    g.gain.value = 0;
    // each chord fades in for its 4s slice of a 16s loop, forever
    for (let k = 0; k < 4000; k++) { const t = t0 + k * 16 + ci * 4; g.gain.setTargetAtTime(0.5, t, 0.8); g.gain.setTargetAtTime(0, t + 3.2, 0.8); }
    o.connect(g).connect(lp); lfo.connect(lg).connect(o.detune);
    o.start(); lfo.start(); nodes.push(o, lfo);
  }));
  lp.connect(gain).connect(a.destination);
  pad = { gain, nodes };
}
export async function music(on: boolean) {
  musicOn = on;
  if (!on) { musicEl?.pause(); pad?.nodes.forEach((n) => (n as OscillatorNode).stop?.()); pad = null; return; }
  if (musicEl) { musicEl.play().catch(() => {}); return; }
  const head = await fetch('/assets/audio/lofi.mp3', { method: 'HEAD' }).catch(() => null);
  if (head?.ok && head.headers.get('content-type')?.startsWith('audio')) {
    musicEl = new Audio('/assets/audio/lofi.mp3'); musicEl.loop = true; musicEl.volume = 0.35;
    musicEl.play().catch(() => {});
  } else if (!pad) await startPad();
}
export function setSfx(on: boolean) { sfxOn = on; }
export function isMusicOn() { return musicOn; }
