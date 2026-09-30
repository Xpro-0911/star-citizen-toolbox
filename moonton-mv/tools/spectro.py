import sys, wave, numpy as np, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
p = sys.argv[1]; out = sys.argv[2]
w = wave.open(p); sr = w.getframerate(); n = w.getnframes()
x = np.frombuffer(w.readframes(n), dtype=np.int16).reshape(-1, 2).astype(np.float32).mean(1) / 32768
fig, ax = plt.subplots(2, 1, figsize=(22, 8), gridspec_kw={'height_ratios': [3, 1]})
ax[0].specgram(x, NFFT=4096, Fs=sr, noverlap=2048, cmap='magma', vmin=-130, vmax=-30)
ax[0].set_yscale('symlog', linthresh=200); ax[0].set_ylim(30, 16000)
BAR = 240/72
for b in [0,6,12,17,23,30,38,44,49,54,61,68]:
    for a in ax: a.axvline(b*BAR, color='cyan', lw=0.6)
hop = sr//10
env = [20*np.log10(np.sqrt((x[i:i+hop]**2).mean())+1e-9) for i in range(0, len(x)-hop, hop)]
ax[1].plot(np.arange(len(env))/10, env); ax[1].set_ylim(-50, -5); ax[1].set_xlim(0, len(x)/sr)
plt.tight_layout(); plt.savefig(out, dpi=60)
