const TARGET_RATE = 16000;

export type VisitRecorder = {
  stop: () => Promise<Blob>;
  cancel: () => void;
};

export async function startVisitRecording(): Promise<VisitRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start();

  const release = () => stream.getTracks().forEach((t) => t.stop());

  return {
    cancel() {
      if (recorder.state !== "inactive") recorder.stop();
      release();
    },
    stop() {
      return new Promise<Blob>((resolve, reject) => {
        recorder.onstop = async () => {
          release();
          try {
            resolve(await toWav(new Blob(chunks, { type: recorder.mimeType })));
          } catch (err) {
            reject(err);
          }
        };
        recorder.stop();
      });
    },
  };
}

export type ListenOptions = {
  /** 0..1 microphone level, roughly 20 times a second */
  onLevel?: (level: number) => void;
  /** Fires once when the speaker pauses after talking, or at maxMs */
  onSilence?: () => void;
  silenceMs?: number;
  maxMs?: number;
};

export type Listener = VisitRecorder & { heardSpeech: () => boolean };

/** Recorder with voice-activity detection for hands-free turns. */
export async function startListening(opts: ListenOptions = {}): Promise<Listener> {
  const { onLevel, onSilence, silenceMs = 1300, maxMs = 45000 } = opts;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start();

  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);

  const started = performance.now();
  let noiseFloor = 0.01;
  let calibrated = false;
  let spoke = false;
  let lastVoice = started;
  let fired = false;

  const tick = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const now = performance.now();
    if (!calibrated) {
      noiseFloor = Math.max(noiseFloor, rms);
      if (now - started > 350) calibrated = true;
    }
    const threshold = Math.max(0.018, noiseFloor * 2.2);
    if (calibrated && rms > threshold) {
      spoke = true;
      lastVoice = now;
    }
    onLevel?.(Math.min(1, rms * 9));
    const pausedAfterSpeech = spoke && now - lastVoice > silenceMs;
    if (!fired && (pausedAfterSpeech || now - started > maxMs)) {
      fired = true;
      onSilence?.();
    }
  }, 50);

  const release = () => {
    clearInterval(tick);
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  };

  return {
    heardSpeech: () => spoke,
    cancel() {
      if (recorder.state !== "inactive") recorder.stop();
      release();
    },
    stop() {
      return new Promise<Blob>((resolve, reject) => {
        recorder.onstop = async () => {
          release();
          try {
            resolve(await toWav(new Blob(chunks, { type: recorder.mimeType })));
          } catch (err) {
            reject(err);
          }
        };
        recorder.stop();
      });
    },
  };
}

async function toWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  await ctx.close();

  const frames = Math.ceil(decoded.duration * TARGET_RATE);
  const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const samples = (await offline.startRendering()).getChannelData(0);

  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, TARGET_RATE, true);
  v.setUint32(28, TARGET_RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}
