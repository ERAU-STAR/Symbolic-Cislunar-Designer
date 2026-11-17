"""Offline data for the symbolic-design web app (v0.2 perturbation models).

Writes into <out>/public/data/:
  qpo_ecc.json, qpo_inc.json : QPO Fourier coefficients (k = -12..12), nuA, nu2
  phases.json                : daily epoch table (TDB 0h) 2020-01-01 .. 2036-01-01
                               f0 (ER3BP osculating true anomaly), HR4BP LVO phase,
                               QHR4BP_Ecc (theta1, theta2), QHR4BP_Inc (theta3, theta2)
                               (same per-epoch fits as qhr4bp.py / hr4bp.py)
  ephem_YYYY.b64.txt         : base64 of Float32 geocentric Moon r,v and Sun r,v [km, km/s], 1 h step,
                               from YYYY-01-01 0h TDB minus 130 days, covering 130 d before
                               to 130 d after the year (backward and forward propagation)
"""
import numpy as np, json, sys, os, datetime as dt
from scipy.optimize import least_squares
from scipy.integrate import solve_ivp
from common import moon_geo, sun_geo, DAY
from qpo import QPO
from qhr4bp import hill_frame, LH, TSB
from hr4bp import S0, _hill
from mapsrun2 import osc_f

out = os.path.join(sys.argv[1], 'public', 'data'); os.makedirs(out, exist_ok=True)
JD2020 = 2458849.5            # 2020-01-01 0h
NDAYS = int(round(2464328.5 - JD2020))   # to 2036-01-01

def qjson(fn, name):
    q = QPO(fn)
    json.dump(dict(re=q.c.real.ravel().tolist(), im=q.c.imag.ravel().tolist(), shape=list(q.c.shape),
                   nuA=float(q.nuA), nu2=float(q.nu2), LH=LH, TSB=TSB),
              open(os.path.join(out, name), 'w'))
    return q
qE = qjson('qh/DataEcc.mat', 'qpo_ecc.json'); qI = qjson('qh/DataInc.mat', 'qpo_inc.json')

# LVO for HR4BP phase
P_LVO = 2*np.pi/12.36874691
lvo = solve_ivp(_hill, (0, P_LVO), S0, rtol=1e-13, atol=1e-14, dense_output=True)
tt = np.linspace(0, P_LVO, 20001); YL = lvo.sol(tt); angL = np.arctan2(YL[1], YL[0])

def fit(q, planar, jd0, guess):
    jd = jd0 + np.linspace(-10, 10, 41)
    rM, vM, F = hill_frame(jd)
    rH = np.array([B@r for r, (B, n) in zip(rM, F)])/LH
    tH = (jd-jd0)*DAY/TSB; dims = 2 if planar else 3
    res = lambda th: (q.eval(tH, th[0], th[1])[:, :dims]-rH[:, :dims]).ravel()
    if guess is None:
        g = np.linspace(0, 2*np.pi, 37)[:-1]; best = None
        for a in g:
            for b in g:
                c = np.sum(res([a, b])**2)
                if best is None or c < best[0]: best = (c, a, b)
        guess = best[1:]
    s = least_squares(res, guess, method='lm')
    e = np.linalg.norm(s.fun.reshape(-1, dims), axis=1)*LH
    return np.mod(s.x, 2*np.pi), float(np.sqrt(np.mean(e**2)))

rows = []; gE = gI = None
for d in range(NDAYS+1):
    jd0 = JD2020 + d
    (aE, bE), eE = fit(qE, True, jd0, gE)
    (aI, bI), eI = fit(qI, False, jd0, gI)
    dtH = DAY/TSB   # warm start for the next day
    gE = [aE + qE.nuA*dtH, bE + qE.nu2*dtH]; gI = [aI + qI.nuA*dtH, bI + qI.nu2*dtH]
    rM, vM, F = hill_frame(np.array([jd0])); B = F[0][0]; r = B@rM[0]
    ph = np.arctan2(r[1], r[0]); k = np.argmin(np.abs(np.angle(np.exp(1j*(angL-ph)))))
    rows.append([round(float(osc_f(jd0)), 9), round(float(tt[k]/P_LVO), 7),
                 round(float(aE), 9), round(float(bE), 9), round(float(aI), 9), round(float(bI), 9),
                 round(eE), round(eI)])
    if d % 500 == 0: print(d, rows[-1], flush=True)
json.dump(dict(jd0=JD2020, step_days=1, cols=['f0', 'hr_phase', 'ecc_thA', 'ecc_th2', 'inc_thA', 'inc_th2',
          'ecc_fit_rms_km', 'inc_fit_rms_km'], rows=rows, lvo=dict(S0=S0.tolist(), P=P_LVO)),
          open(os.path.join(out, 'phases.json'), 'w'))

for year in range(2020, 2036):
    jd0 = JD2020 + (dt.date(year, 1, 1)-dt.date(2020, 1, 1)).days - 130
    n = int((130+366+130)*24)+1
    jd = jd0 + np.arange(n)/24.0
    rM, vM = moon_geo(jd); rS = sun_geo(jd)
    rS2 = sun_geo(jd+1e-3); vS = (rS2-rS)/(1e-3*DAY)
    import base64   # Float32 rows [rM vM rS vS], served as base64 text (static hosts serve .txt)
    open(os.path.join(out, f'ephem_{year}.b64.txt'), 'w').write(base64.b64encode(np.c_[rM, vM, rS, vS].astype('<f4').tobytes()).decode())
print('done')
