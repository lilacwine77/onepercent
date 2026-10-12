#!/usr/bin/env python3
"""Builds the whole Onepercent film audio kit. Pure synthesis: numpy + scipy (+ afconvert for AAC)."""
import os, sys, json, subprocess, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dsp import *
import sfx as S
from bed import render_bed

# Output folder: FILM_AUDIO_OUT, or ./film-audio next to the current directory.
OUT = os.path.abspath(os.environ.get('FILM_AUDIO_OUT', 'film-audio'))
os.makedirs(os.path.join(OUT, 'sfx'), exist_ok=True)
os.makedirs(os.path.join(OUT, 'qc'), exist_ok=True)
SFXD = os.path.join(OUT, 'sfx')
QC = os.path.join(OUT, 'qc')
T0 = time.time()


def log(*a):
    print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)


# ------------------------------------------------------------------ SFX
SFX_DEF = {
    'crt-power-on':  (S.crt_on, {}, 'CRT switch-on: relay clack, degauss buzz, beam zap, static, picture bloom'),
    'crt-power-off': (S.crt_off, {}, 'CRT switch-off: pop + collapsing pew, static fizz'),
    'whoosh-short':  (S.whoosh, dict(d=0.6, peak=0.38, seed=121), 'fast air pass L->R, peak = sync point'),
    'whoosh-long':   (S.whoosh, dict(d=1.6, peak=1.15, seed=122, f_lo=220, f_hi=6500), 'slow build pass L->R, peak = sync point'),
    'card-flip-1':   (S.card_flip, dict(seed=51, pitch=1.0, tw=0.07), 'card flip, snap = sync point'),
    'card-flip-2':   (S.card_flip, dict(seed=52, pitch=1.12, tw=0.06), 'card flip (brighter, quicker)'),
    'card-flip-3':   (S.card_flip, dict(seed=53, pitch=0.9, tw=0.08), 'card flip (darker, slower)'),
    'foil-shimmer':  (S.foil_shimmer, {}, 'foil crinkle + high metallic shimmer'),
    'pack-rip':      (S.pack_rip, {}, 'accelerating foil/paper tear ending in a pop (pop = sync point)'),
    'big-impact':    (S.big_impact, {}, 'sub boom + crack + metal + hall tail for the hit reveal'),
    'coin-sparkle':  (S.coin_sparkle, {}, 'glassy F6/C7 bell pair + sparkle grains'),
    'ui-tick':       (S.ui_tick, {}, 'tight UI tick for text/type-on'),
    'riser-2s':      (S.riser, dict(d=2.0, seed=131), '2.000 s riser, ends at full level: align END to the hit'),
}

sfx_audio, sfx_meta = {}, {}
for name, (fn, kw, desc) in SFX_DEF.items():
    x, sync = fn(**kw)
    y, i0 = finalize_sfx(x)
    sync = max(sync - i0 / SR, 0.0)
    if name == 'riser-2s':
        sync = len(y) / SR
    sfx_audio[name] = y
    sfx_meta[name] = dict(file=f'sfx/{name}.wav', duration_s=round(len(y) / SR, 3), sync_offset_s=round(sync, 4),
                          true_peak_dbtp=round(true_peak_db(y), 2), description=desc)
    write_wav24(os.path.join(SFXD, f'{name}.wav'), y)
log('sfx done')

# ------------------------------------------------------------------ beds
BED_TARGET = -16.0
BED_GAIN = -6.0  # bed fader when stacking SFX (keeps the raw sum below 0 dBFS)
beds = {}
for G, tail, length in ((2, 2.0, 22), (3, 3.0, 25)):
    mix, land, gaps = render_bed(G, tail)
    y = master(mix, BED_TARGET, tp_max=-1.5, fade_out=0.35)
    write_wav24(os.path.join(OUT, f'bed-{length}s.wav'), y)
    beds[length] = dict(pre=mix, out=y, land=land, gaps=gaps)
    log(f'bed {length}s done', land)

# ------------------------------------------------------------------ cue sheet (sync times are for 22 s; 25 s shifts)
def film_cues(L):
    l = L
    d = l['drop']
    return [
        dict(beat='Your bags are dust.', start_s=0.0, end_s=l['groove'],
             music='hook hit at 0.000 (kick + sub + bright Fm stab), then filtered intro',
             sfx=[('crt-power-on', 0.0, 1), ('ui-tick', 1.0, -10)],
             visual='CRT turns on exactly at 0.000; headline lands on 1.000 (beat 3)'),
        dict(beat='Feed the machine.', start_s=l['groove'], end_s=l['riser'],
             music='groove: kick/clap/hats, 808, plucked arp, filter opening',
             sfx=[('whoosh-short', l['groove'], -5)] + [('ui-tick', l['groove'] + 1.0 + 0.5 * k, -10) for k in range(4)],
             visual='cut on groove downbeat; bags drop into the machine on beats (one tick each)'),
        dict(beat='(build)', start_s=l['riser'], end_s=d,
             music='riser bar: snare roll 8ths->16ths->32nds, filter sweep; 62.5 ms of air before the drop',
             sfx=[('foil-shimmer', l['riser'] + 0.5, -8), ('riser-2s', d, -5)],
             visual='pack ejects / glints at riser+0.5; everything tightens into the drop'),
        dict(beat='Rip a pack.', start_s=d, end_s=l['driving'],
             music='DROP at drop (full energy); extra accent (sub + crash) at hit_reveal = drop+4',
             sfx=[('pack-rip', d, 1), ('card-flip-1', d + 1.0, -6), ('card-flip-2', d + 1.5, -6),
                  ('card-flip-3', d + 2.0, -6), ('card-flip-1', d + 2.5, -6), ('whoosh-long', d + 4.0, -6),
                  ('big-impact', d + 4.0, 1), ('coin-sparkle', d + 4.05, -4), ('foil-shimmer', d + 4.1, -9)],
             visual='pack tears open ON the drop (pop = drop); 4 Dust Cards flip on beats drop+1.0/1.5/2.0/2.5; '
                    'anticipation drop+2.5..drop+4; the hit explodes at drop+4.0'),
        dict(beat='Keep it. Redeem it. Sell it back.', start_s=l['driving'], end_s=l['lift'],
             music='driving: four-on-the-floor, offbeat bass, pumping chords',
             sfx=[('whoosh-short', l['driving'], -6), ('ui-tick', l['driving'], -10),
                  ('card-flip-2', l['driving'] + 1.0, -6), ('coin-sparkle', l['driving'] + 2.0, -2)],
             visual='"Keep it." at driving+0, "Redeem it." at +1.0, "Sell it back." at +2.0 (coin), hold to lift'),
        dict(beat='Go for the 1%.', start_s=l['lift'], end_s=l['final_hit'],
             music='lift: big clap on the downbeat, chord swell Db->Eb, snare build, 62.5 ms gap before the final hit',
             sfx=[('ui-tick', l['lift'], -9), ('riser-2s', l['final_hit'], -6)],
             visual='"Go for the 1%." slams on lift+0; scale/zoom build; hard cut at final_hit'),
        dict(beat='End card: "Bags in, Packs out." + onepercent.fun', start_s=l['final_hit'], end_s=l['end'],
             music='final hit (kick + sub + crash + full Fm chord) then reverb/pad tail fading to silence',
             sfx=[('big-impact', l['final_hit'], 1)],
             optional_sfx=[('crt-power-off', l['end'] - 0.6, -3)],
             visual='end card appears ON final_hit; optional CRT collapse in the last 0.6 s'),
    ]


def win(x, t0, t1):
    a, b_ = max(N(t0), 0), min(N(t1), len(x))
    return x[a:b_]


def resolve_gain(bed, name, t, rel):
    """dB to apply to the SFX file so that, around its sync point, it sits `rel` LU vs the delivered bed."""
    y = sfx_audio[name]
    off = sfx_meta[name]['sync_offset_s']
    ys = np.zeros((N(0.4), 2))
    add(ys, y, 0.1 - off)
    lb = lufs(win(bed, t - 0.1, t + 0.3) * db(BED_GAIN))
    if not np.isfinite(lb):
        lb = lufs(bed)
    return round(rel + lb - lufs(ys), 1)


def resolve(cues, bed):
    for c in cues:
        for key in ('sfx', 'optional_sfx'):
            if key in c:
                c[key] = [(nm, t, resolve_gain(bed, nm, t, rel), rel) for nm, t, rel in c[key]]
    return cues


def cue_json(cues):
    out = []
    for c in cues:
        c = dict(c)
        for key in ('sfx', 'optional_sfx'):
            if key in c:
                c[key] = [dict(file=sfx_meta[nm]['file'], sync_at_s=round(t, 4),
                               place_file_start_s=round(t - sfx_meta[nm]['sync_offset_s'], 4), gain_db=g,
                               level_vs_bed_lu=rel)
                          for nm, t, g, rel in c[key]]
        out.append(c)
    return out


# ------------------------------------------------------------------ preview mix (22 s)
pre = beds[22]['pre'].copy()
prev = beds[22]['out'] * db(BED_GAIN)  # delivered bed at BED_GAIN, SFX on top
cues22 = resolve(film_cues(beds[22]['land']), beds[22]['out'])
for c in cues22:
    for nm, t, g, rel in c['sfx']:
        add(prev, sfx_audio[nm], t - sfx_meta[nm]['sync_offset_s'], db(g))
PREV_TARGET = -14.0
pv = master(prev, PREV_TARGET, tp_max=-1.5, fade_out=0.35)
pv_path = os.path.join(OUT, 'preview-22s.wav')
write_wav24(pv_path, pv)
m4a = os.path.join(OUT, 'preview-22s.m4a')
if os.path.exists(m4a):
    os.remove(m4a)
subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '256000', '-q', '127', pv_path, m4a], check=True)
chk = os.path.join(QC, '_decode_check.wav')
subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEF32', m4a, chk], check=True)
dec, _ = read_wav(chk)
os.remove(chk)
log('preview done')

# ------------------------------------------------------------------ QC
def qc(x):
    M = (x[:, 0] + x[:, 1]) / 2
    Sd = (x[:, 0] - x[:, 1]) / 2
    lo = bw(x, 'lowpass', 120, 4)
    loS = (lo[:, 0] - lo[:, 1]) / 2
    loM = (lo[:, 0] + lo[:, 1]) / 2
    corr = float(np.sum(x[:, 0] * x[:, 1]) / np.sqrt(np.sum(x[:, 0] ** 2) * np.sum(x[:, 1] ** 2)))
    d = np.abs(np.diff(x, axis=0)).max(1)
    k = np.ones(N(0.005)); k[len(k) // 2 - 2:len(k) // 2 + 3] = 0
    loc = np.sqrt(np.convolve(d ** 2, k / k.sum(), mode='same')) + 1e-9
    clicks = np.where((d > 10 * loc) & (d > db(-40)))[0]
    return dict(
        integrated_lufs=round(lufs(x), 2), true_peak_dbtp=round(true_peak_db(x), 2),
        sample_peak_dbfs=round(sample_peak_db(x), 2), clipped_samples=int(np.sum(np.abs(x) >= 0.99999)),
        dc_offset_dbfs=[round(20 * np.log10(abs(x[:, c].mean()) + 1e-12), 1) for c in range(2)],
        lr_correlation=round(corr, 3),
        side_to_mid_db=round(10 * np.log10(np.sum(Sd ** 2) / np.sum(M ** 2)), 1),
        side_to_mid_below_120hz_db=round(10 * np.log10(np.sum(loS ** 2) / np.sum(loM ** 2) + 1e-20), 1),
        first_sample_dbfs=round(20 * np.log10(np.abs(x[0]).max() + 1e-12), 1),
        last_sample_dbfs=round(20 * np.log10(np.abs(x[-1]).max() + 1e-12), 1),
        isolated_hf_spikes=[round(i / SR, 3) for i in clicks[:20]],
        max_short_term_lufs=round(short_term(x)[1].max(), 2),
    )


report = {}
for L in (22, 25):
    report[f'bed-{L}s.wav'] = qc(beds[L]['out'])
report['preview-22s.wav'] = qc(pv)
report['preview-22s.m4a (decoded)'] = dict(integrated_lufs=round(lufs(dec), 2), true_peak_dbtp=round(true_peak_db(dec), 2))
for nm, y in sfx_audio.items():
    report[f'sfx/{nm}.wav'] = dict(dur=round(len(y) / SR, 3), dc=round(20 * np.log10(abs(y.mean()) + 1e-12), 1),
                                   first=round(20 * np.log10(np.abs(y[0]).max() + 1e-12), 1),
                                   last=round(20 * np.log10(np.abs(y[-1]).max() + 1e-12), 1),
                                   lufs=round(lufs(y), 1), tp=round(true_peak_db(y), 2))
with open(os.path.join(QC, 'qc-report.json'), 'w') as f:
    json.dump(report, f, indent=1)

# ------------------------------------------------------------------ spectrograms
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


def spec_png(x, path, title, land):
    m = x.mean(1)
    f, t, Z = sig.spectrogram(m, SR, nperseg=2048, noverlap=1536, window='hann')
    Zd = 10 * np.log10(Z + 1e-14)
    fig, ax = plt.subplots(2, 1, figsize=(12, 5.2), sharex=True, gridspec_kw=dict(height_ratios=[3, 1]))
    ax[0].pcolormesh(t, f[1:], Zd[1:], shading='auto', cmap='magma', vmin=Zd.max() - 85, vmax=Zd.max())
    ax[0].set_yscale('log'); ax[0].set_ylim(25, 22000); ax[0].set_ylabel('Hz'); ax[0].set_title(title)
    ts, st_ = short_term(x, 3.0)
    tm, mo = short_term(x, 0.4, 0.05)
    ax[1].plot(tm, mo, lw=0.8, label='momentary'); ax[1].plot(ts, st_, lw=1.4, label='short-term')
    ax[1].set_ylim(-40, -5); ax[1].set_ylabel('LUFS'); ax[1].set_xlabel('s'); ax[1].legend(loc='lower right', fontsize=7)
    for k, v in land.items():
        if k in ('intro', 'tail'):
            continue
        for a in ax:
            a.axvline(v, color='cyan', lw=0.6, alpha=0.7)
        ax[0].text(v + 0.05, 30, k, color='cyan', fontsize=7, rotation=90, va='bottom')
    fig.tight_layout(); fig.savefig(path, dpi=80); plt.close(fig)


spec_png(beds[22]['out'], os.path.join(QC, 'spec-bed-22s.png'), 'bed-22s.wav', beds[22]['land'])
spec_png(beds[25]['out'], os.path.join(QC, 'spec-bed-25s.png'), 'bed-25s.wav', beds[25]['land'])
spec_png(pv, os.path.join(QC, 'spec-preview-22s.png'), 'preview-22s.wav', beds[22]['land'])

# ------------------------------------------------------------------ cues.json
def grid(L):
    return dict(bars_s=[round(2.0 * i, 3) for i in range(int(L // 2) + 1) if 2.0 * i <= L],
                beats_s=[round(0.5 * i, 3) for i in range(int(L / 0.5) + 1)])


cues = dict(
    tempo_bpm=120, time_signature='4/4', beat_s=0.5, bar_s=2.0, sixteenth_s=0.125, sample_rate=48000,
    key='F minor', note='All times in seconds from file start. Bed sample 0 = hook hit (transient on sample 0). '
                        'place_file_start_s = where the SFX file must start so its sync point lands on sync_at_s.',
    beds={},
    sfx=sfx_meta,
    preview={'file': 'preview-22s.wav', 'aac': 'preview-22s.m4a',
             'mix_rule': 'bed-22s.wav at bed_gain_db (-6 dB) + each SFX file at its gain_db, starting at place_file_start_s; then master (limiter) to -14 LUFS / -1.5 dBTP', 'bed_gain_db': BED_GAIN},
)
for L, tail in ((22, 2.0), (25, 3.0)):
    land = beds[L]['land']
    cues['beds'][f'bed-{L}s.wav'] = dict(
        duration_s=L, loudness_lufs=report[f'bed-{L}s.wav']['integrated_lufs'],
        true_peak_dbtp=report[f'bed-{L}s.wav']['true_peak_dbtp'],
        landmarks={k: v for k, v in land.items()},
        sections=[dict(name='hook + filtered intro', start=0.0, end=land['groove']),
                  dict(name='groove', start=land['groove'], end=land['riser']),
                  dict(name='riser', start=land['riser'], end=land['drop']),
                  dict(name='drop (pack rip)', start=land['drop'], end=land['driving']),
                  dict(name='driving', start=land['driving'], end=land['lift']),
                  dict(name='lift (Go for the 1%)', start=land['lift'], end=land['final_hit']),
                  dict(name='final hit + tail (end card)', start=land['final_hit'], end=land['end'])],
        silent_gaps_s=beds[L]['gaps'],
        film_beats=cue_json(resolve(film_cues(land), beds[L]['out'])),
        **grid(L))
with open(os.path.join(OUT, 'cues.json'), 'w') as f:
    json.dump(cues, f, indent=1)

print(json.dumps({k: v for k, v in report.items() if not k.startswith('sfx/')}, indent=1))
for k, v in report.items():
    if k.startswith('sfx/'):
        print(k, v, 'sync', sfx_meta[k[4:-4]]['sync_offset_s'])
log('all done')
