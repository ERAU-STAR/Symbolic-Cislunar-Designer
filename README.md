# Cislunar Symbolic Designer (v0.3)

Interactive symbolic trajectory design for the Earth-Moon system, built on
Jo, Sahin & Canales, "Symbolic Dynamics of Cislunar Transport" (AAS 27-530).
Everything runs on the device (browser Web Workers); nothing is sent to a server.

## Run
```
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (GitHub Pages ready, base './')
```

## Screens
1. **Word**: Earth-Moon partition (graph_region_v7 rules) or the symbolic graph
   G(1)..G(9) (Table 1). C slider with the regime thresholds, live ZVC, perturbation
   switches (only CR3BP runs in v0.1), tap regions/nodes to build a word.
2. **Symbolic map**: lunar-ellipse section for the word's first (entry) transition.
   psi1/psi2 window (numbers, zoom box, accessible boundary pieces), horizon slider,
   "Your word" (prefix match) / "All classes" (paper class words), fine/coarse alphabet.
   Coarse grid first, then only blocks whose corners differ are refined; every level is
   checkpointed in IndexedDB.
3. **Trajectory**: rotating/inertial views, time scrubber, word timeline, IC export.

## Code map
- `src/core/constants.ts`  CR3BP constants, libration points, partition geometry, Table 1 regimes
- `src/core/symbols.ts`    alphabet, colours, graph layout and edge family
- `src/core/partition.ts`  point classifier (= classify_region) and display raster (v7 rules)
- `src/core/cr3bp.ts`      DOP853 propagation with on-line region tracking
- `src/core/section.ts`    ellipse section states, entry arcs, default window
- `src/core/words.ts`      class words, prefix match, coarse alphabet
- `src/core/mapEngine.ts`  adaptive dyadic refinement, worker pool, cache
- `src/ui/*`               React screens

## Validation
`validation/fig12*.{npz,json}` hold the class map extracted from the paper's Fig. 12
(FTLE_symbolicmap.fig: C = 3.1666, psi1 181-204 deg, psi2 17-52 deg, 0.2 deg).
`tests/fig12.ts` reproduces it: 98.7 % of 864 sampled cells give the same class
(the rest are isolated boundary cells).
```
node_modules/.bin/esbuild tests/fig12.ts --bundle --platform=node --format=esm --outfile=/tmp/fig12.mjs && node /tmp/fig12.mjs 15 5
```

## Models (v0.2)
Perturbation switches pick the model: none = CR3BP, Moon eccentricity = ER3BP, Sun = HR4BP,
Sun + eccentricity = QHR4BP (DataEcc), Sun + inclination = QHR4BP (DataInc), full ephemeris = HFEM
(Earth, Moon, Sun point masses, JPL DE421). The epoch (2020-2035, TDB) sets f0, the LVO phase and the
QPO angles (`public/data/phases.json`, same per-epoch fits as the Python/MATLAB pipeline) and the
HFEM ephemeris (`public/data/ephem_YYYY.b64.txt`, hourly Float32). Section states use the
"same position + instantaneous angular-rate" convention, so psi1, psi2 and C_ref are shared.
`src/core/models.ts` holds the dynamics; `src/core/modelSetup.ts` builds them for an epoch;
`tests/app_data_gen.py` regenerates the data files (needs the QHR4BP Python package).
Cross-check against the Python engine (60 points, C = 3.1666, 2026-04-05): CR3BP 60/60,
ER3BP 59/60, HR4BP 60/60, QHR4BP ecc 60/60, QHR4BP inc 60/60, HFEM 59/60.

## Sections and past/future words (v0.3)
Any non-impact graph edge can be the section (`src/core/boundary.ts`): the lunar ellipse, the
L3-L4-L5 circle, the lines x = x_L1, x_Moon, x_L2, 0, the line y = 0 and the Earth-L4/L5 rays.
The boundary pieces that separate the two regions and are accessible at C are found by scanning
each curve. Tap a symbol in the word bar to move "now": the section is the transition into that
symbol; later symbols are matched forward, earlier ones by backward propagation over the same
horizon (`propagate(..., { dir: -1 })`; model tables cover +-horizon, ephemeris files +-130 d).
Checks: Fig. 12 through the general section 98.7 %; CR3BP backward run equals the mirrored forward
run; backward QHR4BP/HFEM agree with the Python engine to ~1e-5 / 1e-8.

## Screen 4: maneuvers (v0.9)
`src/core/maneuver.ts`, `src/ui/ManeuverScreen.tsx`. Impulsive burns on the trajectory chosen on screen 3, in any
model. A burn is an instantaneous inertial velocity change: the model state's velocity changes by A^-1 dv with
A = dI/dx, the Jacobian of the model's inertial snapshot with respect to its position, so one code path serves
every model. Components in VNB about the Moon, VNB about the Earth (V = velocity relative to that body, N = orbit
normal, B = V x N) or the rotating x, y, z axes; values in m/s (typed, -/+ with a step of 10^-3 to 100 m/s).
Burn times in days after the section crossing (typed or slider); any number of burns, each can be switched off.
The plan is re-propagated on every change (CR3BP ~1-5 ms, HFEM ~10-25 ms). After a burn the word is classified with
the new C (CR3BP: exact Jacobi; other models: the CR3BP-equivalent change of the pulsating speed). Shows the
trajectory without burns, where the word changes, the total dv, and exports the plan as JSON (burn times, dv in
the chosen frame, rotating and inertial, model states before and after each burn).
Checks (`tests/maneuver.ts`): measured inertial dv equals the request to 1e-4 m/s in every model and frame;
no-burn plan = plain propagation; CR3BP C after the burn = Jacobi of the new state; CR3BP rotating-x 10 m/s
changes vx by exactly 0.01 / (LSTAR/TSTAR).
Fix found on the way: the integrator could stall at the end of a segment when the remaining time fell below the
rounding of t (HFEM uses seconds); the last step now lands exactly on the end time.

## Δv as magnitude and direction; Δv symbolic map (v0.10)
A burn is |Δv| [m/s], in-plane direction α and out-of-plane angle β [deg]. VNB frames: α from V towards B
(0 = prograde, 90 = outward, 180 = retrograde), β towards N (orbit normal); rotating frame: α from +x towards +y,
β towards +z (the same convention as ψ₂ / ψ₃). Components are shown for reference and exported.
Δv map (screen 4 → "Δv map", `src/ui/DvMap.tsx`): adaptive map over (α, |Δv|) at fixed β or (α, β) at fixed |Δv|
for the selected burn (earlier burns applied, later ones ignored), coloured by the word after the burn (first
4–20 symbols) or by how much of your word the whole trajectory realises. Runs on the map engine through a
`custom` map (model states at the burn time, each with its own C; `prepareDvMap` precomputes the Jacobian so a
grid point costs one linear update). Clicking or dragging on the map sets the burn and the trajectory updates.
Check: the map's state for a grid point equals the full plan's post-burn state (relative difference < 1e-17) and
gives the same word and C in all six models.

## v0.11
- Jacobi constant down to 0 (slider: upper 80 % = 3.25 .. 2.95, lower 20 % = 2.95 .. 0; typed values 0 .. 3.25).
- Hand-set phase angles (screens 2-4, model box): ER3BP f0, HR4BP theta2, QHR4BP-e theta1 / theta2, QHR4BP-i theta3 / theta2
  (sliders 0-360 deg, epoch value shown); part of the model key, so maps are cached per phase. HFEM keeps the ephemeris.
- Screen 4: "-/+ button size" (how much one press changes |dv| and the angles); dv map next to the trajectory; the map
  follows the time slider (a click on it moves the selected burn to that time, or creates one); backward design
  ("a burn changes the past"): the trajectory after the last burn is kept, the state before each burn is
  (after - dv) propagated backward, burn times from -horizon to +horizon, and the dv map colours the word before the
  burn (read backward). Checks in `tests/maneuver_back.ts`.

## Real missions (v0.12)
"Missions" (header): Artemis I and II (NASA/JSC OEM), CAPSTONE, KPLO/Danuri, GRAIL-A (JPL Horizons, converted to OEM
in public/data/missions), or any CCSDS OEM / Horizons vector table (Earth- or Moon-centred, km, km/s; UTC/TAI/TT/TDB
with leap seconds). `src/core/mission.ts`: states -> geocentric TDB -> pulsating Earth-Moon states in the section
convention (instantaneous frame, rho' = d rho / d tau'), Jacobi-like C per sample, the symbolic word (each sample at its
own C, crossings refined by Hermite interpolation + bisection), boundary crossings with (psi1 or s, psi2, z, psi3, C) and
their section piece, and maneuvers: HFEM propagation over every sample interval, residual |dv| above the threshold and
8x its local median, merged spans turned into one impulse at the middle (forward/backward propagation), components in
VNB about the Moon. "Use" on a crossing sets C, the word, the section point, HFEM and the epoch (to the second) and
optionally loads the maneuvers into screen 4; the real trajectory is drawn in purple on screens 1, 3 and 4.
Ephemeris tables now include 2011-2012 (GRAIL); HFEM can be built over any span (`buildHfemRange`, stitched year files).
Checks (`tests/missions.ts`): HFEM from a crossing follows the real trajectory to 3-4 km over 3 days (CAPSTONE, KPLO,
GRAIL cruise) and ~17-70 km over 1-2 days before the Artemis I powered flyby; Artemis I maneuvers found: OPF 179 m/s
(11-21 12:47), DRI 111 m/s (11-25 21:56), DRDB 138 m/s (12-01 21:58), RPF 292 m/s (12-05 16:48).
"closest real epoch" (model box, hand-set phases): searches the 2020-2035 phase table for the date whose phase angles
are closest, so HFEM can be run with about the same geometry.

## v0.13
- Start screen with the Symbolic Cislunar Designer logo, the STAR Group mark, the NSF funding statement and logo, and
  the credit "Developed by Seur Gi Jo · STAR Group, Embry-Riddle Aeronautical University" (public/brand, src/brand.ts);
  no copyright line until ownership is settled with the PI / ERAU. Click the logo or Start; the header logo goes back.
- Real-mission crossings of the current section edge are drawn on the screen-2 map as purple diamonds (hover for the
  date and C; the one in use is larger).
- Mission panel: click a maneuver to open screen 4 at it: the last usable crossing before the maneuver is used as the
  section (with the mission's maneuvers loaded), the burn is selected, and its Δv map opens with |Δv| range and β
  fitted so the executed Δv (red triangle) is on the map.

## v0.14: mission maneuvers fitted to the real trajectory
The detected impulses alone do not reproduce a mission (Artemis I: 700 km off after 5 d, 230 000 km after 21 d): the
point-mass HFEM drifts from the flown path (tens of km by the 130 km lunar flyby) and a finite burn is not an impulse.
`src/core/missionFit.ts` re-solves each maneuver in time order in the app's own model (same epoch, section state and
propagator settings as screen 4): Newton with a finite-difference Jacobian and step halving, so that the trajectory
after the burn passes through the real position min(2 d, next burn - 0.05 d) later. Maneuvers with no real data to aim
at (after the end of the file) are switched off. Each burn shows its note ("fitted ... (detected ...), miss ... km").
Artemis I with the fitted burns stays within 3-66 km of the real trajectory over 21 d (OPF 175.6, DRI 111.6,
DRDB 138.6, RPF 279.0 m/s); Artemis II within 1 km over 5 d; CAPSTONE within 15 km after its fitted burn.
Mission panel: "Use" / "Δv map" buttons moved to the first column and the tables keep their height (the panel scrolls).

## v0.15

- Built-in missions: only Artemis I and II are shipped. CAPSTONE, KPLO and GRAIL were removed (their Horizons tables start after Earth departure, so they were incomplete). Any CCSDS OEM or JPL Horizons vector table can still be loaded with **Missions → Load a file…**; the 2011–2012 and 2020–2035 ephemeris tables are kept.
- All screens open on the full Earth–Moon view (2D views and the 3D view centred on the Earth–Moon system); the Moon-centred view is one click away.
- Screen 4, default mode "the side away from the section": the trajectory is propagated both ways from the section (−horizon … +horizon). Burns after the section change the future; burns before it change the past (the state at the section is kept). Burns can be added at negative times and the Δv map works there too (read backward).
- Mission maneuvers before the crossing are also fitted to the real trajectory (backward from the section, target inside the data span).
- New test: tests/maneuver_anchored.ts.

## Notation
| symbol | meaning |
|---|---|
| ψ₁ | position angle on a curved section boundary (lunar ellipse, L3–L4–L5 circle) [deg] |
| s | coordinate along a straight section boundary (x = const, y = 0, Earth–L4/L5 rays) [ndim] |
| ψ₂ | in-plane velocity angle, from +x in the rotating frame [deg] |
| z | height of the section point above the Earth–Moon plane [ndim] |
| ψ₃ | out-of-plane velocity angle (elevation above the Earth–Moon plane) [deg] |
| θ₁, θ₂, θ₃, f₀ | epoch phase angles of the perturbation models (QPO angles, ER3BP true anomaly) |

## 3D (v0.4–v0.7)
- 3D symbolic map (map screen → "3D volume", `src/ui/Volume3D.tsx`): a stack of adaptive (ψ₁ or s, ψ₂)
  maps, one per layer of ψ₃ (z fixed) or z (ψ₃ fixed); 7 / 13 / 25 layers, 49² or 97² per layer, middle
  layer first, each layer cached like any map. Shown as voxels: "Boundaries" = voxels whose class differs
  from a neighbour (largest class hidden by default), "Cloud" = every voxel; a highlighted legend entry is
  drawn solid. The selected layer is a textured plane and the 2D map below; click a voxel to mark it,
  then open its trajectory.
- Slices: every map can be taken at fixed z, ψ₃; (z, ψ₃) maps at a fixed section point (s or ψ₁, ψ₂).
- 3D viewer (trajectory screen → 3D, `src/ui/Traj3D.tsx`, three.js, loaded on demand): rotating frame
  with the trajectory coloured by symbol region, the zero-velocity surface 2U(x, y, z) = C (CR3BP
  reference, height field clipped at the in-plane ZVC and at |z| = 0.55), the lunar-ellipse cylinder,
  the L3–L4–L5 circle and the section; or the inertial frame (epoch Earth–Moon plane) with the Moon's
  path and the Sun direction. Views 3D / x–y / x–z / y–z; Moon- or Earth–Moon-centred.

## Colours (v0.8)
All-classes maps have two schemes (legend panel): **Distinct** (default; Tableau-20 order without greys, then
golden-angle extras) and **By ending** (family of the last symbol: E red, E_C* dark red, M grey/blue, X yellow).
A "by branch" scheme (hue from the first symbols) is still in palette.ts but hidden from the UI. Each scheme keeps
a class's colour for the session, so maps of different models and epochs compare directly. Thin class-boundary
lines are on by default (drawn where the displayed colour changes, so "Other" is not outlined class by class).

## Next
Zero-velocity surface per model at the section epoch, 3D region view on the word screen,
mission overlays (Artemis II, KPLO, CAPSTONE), FTLE overlay, trajectory metrics / filters.
