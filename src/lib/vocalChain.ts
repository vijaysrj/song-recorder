// A small "studio" vocal chain built from Web Audio nodes, the same steps a
// sound engineer applies to a singer:
//   1. High-pass: removes rumble, handling noise and breath pops below 85 Hz.
//   2. Cut boxiness around 300 Hz that small phone mics exaggerate.
//   3. Presence lift around 3.5 kHz so words come through the music.
//   4. Gentle de-ess: dips harsh "s" sounds around 7 kHz.
//   5. "Air" shelf above 10 kHz for a polished, open top end.
//   6. Vocal compressor so quiet and loud lines sit evenly over the track,
//      then make-up gain.
//   7. Reverb (a short vocal plate), mixed in parallel; amount is adjustable.

export type VocalChain = {
  input: AudioNode;
  output: AudioNode;
  setReverb: (amount: number) => void;
};

export function buildVocalChain(ctx: BaseAudioContext, studio: boolean, reverb: number): VocalChain {
  const input = ctx.createGain();
  const output = ctx.createGain();

  if (!studio) {
    input.connect(output);
    return { input, output, setReverb: () => {} };
  }

  const eq = (type: BiquadFilterType, freq: number, gain = 0, q = 0.7) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.gain.value = gain;
    f.Q.value = q;
    return f;
  };

  const highpass = eq("highpass", 85, 0, 0.7);
  const mud = eq("peaking", 300, -3, 1);
  const presence = eq("peaking", 3500, 3, 0.9);
  const deEss = eq("peaking", 7000, -2.5, 3);
  const air = eq("highshelf", 10000, 3);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -22;
  comp.knee.value = 8;
  comp.ratio.value = 3.5;
  comp.attack.value = 0.004;
  comp.release.value = 0.16;

  const makeup = ctx.createGain();
  makeup.gain.value = 1.6; // about +4 dB back after compression

  input.connect(highpass).connect(mud).connect(presence).connect(deEss).connect(air).connect(comp).connect(makeup);

  // Dry voice straight to the output.
  makeup.connect(output);

  // Reverb send: brighten-cut the send first so the tail isn't hissy.
  const send = eq("lowpass", 6000);
  const plate = ctx.createConvolver();
  plate.buffer = plateImpulse(ctx, 1.8);
  const wet = ctx.createGain();
  wet.gain.value = reverbGain(reverb);
  makeup.connect(send).connect(plate).connect(wet).connect(output);

  return {
    input,
    output,
    setReverb: (amount) => {
      wet.gain.setTargetAtTime(reverbGain(amount), ctx.currentTime, 0.05);
    },
  };
}

const reverbGain = (amount: number) => Math.max(0, Math.min(1, amount)) * 0.6;

// Synthetic plate reverb: stereo decaying noise with a short pre-delay,
// darker as it fades (like a real room absorbing high notes).
function plateImpulse(ctx: BaseAudioContext, seconds: number) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const preDelay = Math.floor(rate * 0.02);
  const buf = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let lp = 0;
    for (let i = preDelay; i < length; i++) {
      const t = (i - preDelay) / (length - preDelay);
      const env = Math.pow(1 - t, 3.2);
      // One-pole low-pass that closes over time.
      const k = 0.6 - 0.45 * t;
      lp += k * (Math.random() * 2 - 1 - lp);
      data[i] = lp * env;
    }
  }
  return buf;
}
