/**
 * Generates assets/sounds/sos.wav: "SOS" in Morse code (· · · — — — · · ·).
 *
 * Written from code rather than downloaded, so there is no licence to track.
 * A soft 880 Hz tone with rounded edges — clearly an alert, but a chime rather
 * than a siren, because it repeats until someone deals with it.
 *
 * Run with `node scripts/make-sos-sound.js`.
 */

const fs = require("fs");
const path = require("path");

const RATE = 22050;
const UNIT_S = 0.09; // one Morse "dit"
const FREQ = 880;
const FADE_S = 0.012; // no clicks at the edges of each tone
const PEAK = 0.42;

// dit=1 on, dah=3 on; 1 unit between marks, 3 between letters.
const pattern = [];
const letter = (marks) =>
  marks.forEach((m, i) => {
    pattern.push([true, m]);
    if (i < marks.length - 1) pattern.push([false, 1]);
  });
letter([1, 1, 1]);
pattern.push([false, 3]);
letter([3, 3, 3]);
pattern.push([false, 3]);
letter([1, 1, 1]);
pattern.push([false, 2]); // a short tail so the last dit is not clipped

const samples = [];
let phase = 0;
for (const [on, units] of pattern) {
  const n = Math.round(units * UNIT_S * RATE);
  for (let i = 0; i < n; i += 1) {
    let v = 0;
    if (on) {
      const t = i / RATE;
      const len = n / RATE;
      const env = Math.min(1, t / FADE_S, (len - t) / FADE_S);
      // A touch of the octave makes it carry on a small phone speaker.
      v = PEAK * env * (Math.sin(phase) + 0.18 * Math.sin(2 * phase));
    }
    phase += (2 * Math.PI * FREQ) / RATE;
    samples.push(v);
  }
}

const data = Buffer.alloc(samples.length * 2);
samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));

const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);

const out = path.join(__dirname, "..", "assets", "sounds", "sos.wav");
fs.writeFileSync(out, Buffer.concat([header, data]));
console.log(`${out}: ${(samples.length / RATE).toFixed(2)} s, ${Math.round((44 + data.length) / 1024)} KB`);
