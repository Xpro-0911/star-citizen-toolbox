import sys, wave, numpy as np
p = sys.argv[1] if len(sys.argv) > 1 else 'output/music.wav'
w = wave.open(p); sr = w.getframerate(); n = w.getnframes()
x = np.frombuffer(w.readframes(n), dtype=np.int16).reshape(-1, 2).astype(np.float32) / 32768
mono = x.mean(1)
BAR = 240 / 72
names = [('title',0),('shanghai',6),('magicrush',12),('mlbb',17),('storm',23),('sea',30),('plateau',38),('home',44),('stars',49),('peak',54),('finale',61),('end',68)]
print(f'dur {n/sr:.1f}s peak {np.abs(x).max():.3f}')
for (a, ba), (_, bb) in zip(names, names[1:]):
    seg = mono[int(ba*BAR*sr):int(bb*BAR*sr)]
    rms = 20*np.log10(np.sqrt((seg**2).mean())+1e-9)
    sp = np.abs(np.fft.rfft(seg[:sr*8] * np.hanning(min(len(seg), sr*8))))
    fr = np.fft.rfftfreq(min(len(seg), sr*8), 1/sr)
    cent = (sp*fr).sum()/sp.sum()
    print(f'{a:10s} bars {ba:2d}-{bb:2d}  rms {rms:6.1f} dB  centroid {cent:6.0f} Hz')
# per-bar loudness curve
line = []
for k in range(69):
    seg = mono[int(k*BAR*sr):int((k+1)*BAR*sr)]
    if len(seg)==0: break
    line.append(20*np.log10(np.sqrt((seg**2).mean())+1e-9))
print(' '.join(f'{v:.0f}' for v in line))
