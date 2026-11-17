# Symbolic Cislunar Designer

Interactive symbolic trajectory design for the Earth–Moon system. Based on
Jo, Sahin & Canales, "Symbolic Dynamics of Cislunar Transport" (AAS 27-530).

**Run it online:** https://erau-star.github.io/Symbolic-Cislunar-Designer/

The Earth–Moon space is split into 14 regions (symbols). A trajectory is then described by the sequence of
regions it visits, which is its *word*. The app lets you do the design in that order:

1. pick a word;
2. map which initial conditions on a section realise it;
3. open and fine-tune the trajectory;
4. change it with impulsive maneuvers.

Six dynamical models are available, from the CR3BP to a full ephemeris model. Real missions (OEM / Horizons
files) can be loaded and used as starting points.

All computation runs in the browser, using Web Workers for the maps. Nothing is sent to a server.

Developed by Seur Gi Jo · STAR Group, Embry-Riddle Aeronautical University.
This work is supported by the National Science Foundation under ERI Award CMMI-2501408 (PI: Dr. David Canales).

---

## Contents
- [Quick start](#quick-start)
- [Using the app](#using-the-app)
- [Notation](#notation)
- [Dynamical models](#dynamical-models)
- [Real missions](#real-missions)
- [How it works](#how-it-works)
- [Code map](#code-map)
- [Validation and tests](#validation-and-tests)
- [Deployment](#deployment)

## Quick start
You need Node.js 18 or later (22 recommended).
```
npm install
npm run dev        # development server, http://localhost:5173
npm run build      # type check + static site in dist/
npm run preview    # serve the built site, http://localhost:4173
```
The build uses `base: './'`, so `dist/` works from any sub-path, such as GitHub Pages or a folder on a web
server.

## Using the app
A start screen comes first; click the logo or **Start** to begin. The header logo takes you back to it. The
header also holds the four screens and the **Missions** panel.

### 1 · Word
- Shows the Earth–Moon partition (the regions E, M, X with their sub-regions) or the symbolic graph G(1)…G(9).
- The **Jacobi constant C** slider runs from 3.25 down to 0. The regime thresholds and the zero-velocity curve
  update live, and the accessible graph changes with the regime.
- Tap regions or graph nodes to build a word. Only allowed transitions can be chosen.

### 2 · Symbolic map
- The section is the transition into the selected symbol of the word. Any non-impact edge can be the section:
  - the lunar ellipse;
  - the L3–L4–L5 circle;
  - the lines x = x_L1, x_Moon, x_L2 and 0;
  - the line y = 0;
  - the Earth–L4/L5 rays.
- The map is drawn over (ψ₁ or s, ψ₂). It can also be drawn as a slice at fixed z and ψ₃, or over (z, ψ₃) at
  a fixed section point.
- Each point is coloured by:
  - **Your word**: how many symbols of your word the trajectory realises; or
  - **All classes**: the word class it falls into, with the colour schemes *Distinct* and *By ending*, and
    optional class-boundary lines.
- Maps are adaptive: a coarse grid first, then only the blocks whose corners differ are refined. Every level is
  cached in the browser (IndexedDB), so revisiting a map is instant.
- Zoom box, zoom out, and back to the previous view. The map keeps its place when you switch modes.
- **3D volume**: a stack of maps, one layer per ψ₃ (or z), shown as voxels. Click a voxel to open its
  trajectory.
- Words before the section are found by backward propagation, so the section can sit anywhere in the word.
- When a mission is loaded, its crossings of the current section edge are drawn as purple diamonds.

### 3 · Trajectory
- Click a point on the map to open its trajectory.
- Views: rotating, side (x–z), inertial, and a 3D viewer (three.js). The 3D viewer shows the trajectory coloured
  by region, the zero-velocity surface, the section, and the Moon's path in the inertial frame. It has an
  Earth–Moon view (default) and a Moon-centred view.
- **Fine-tune**: a mini map around the point (drag on it), −/+ nudges with coarse/medium/fine steps, a step
  slider, and typed values for ψ₁ / s, ψ₂, z, ψ₃.
- A time slider and a word timeline. Initial conditions can be exported.

### 4 · Maneuvers
- Impulsive burns on the trajectory from screen 3, in any model.
- A burn is set by |Δv| [m/s], the in-plane direction α and the out-of-plane angle β. It can be given in three
  frames:
  - VNB about the Moon;
  - VNB about the Earth;
  - the rotating frame.
- Burn times run from −horizon to +horizon days around the section crossing, typed or set with a slider. Each
  burn can be switched off.
- Two ways a burn acts:
  - **the side away from the section** (default): the state at the section is kept. Burns after it change the
    future, and burns before it change the past.
  - **only the past (keep the end)**: the trajectory after the last burn is kept, and each earlier state is
    (state after − Δv) propagated backward.
- **Δv map**: a symbolic map over (α, |Δv|) at fixed β, or (α, β) at fixed |Δv|, for the selected burn. It is
  coloured by the word after the burn (or before it, read backward), or by how much of your word is realised.
  - Clicking or dragging on the map sets the burn.
  - The map can sit next to the trajectory and follow the time slider.
- The trajectory without burns and the changed symbols are shown. The plan can be exported as JSON (burn times,
  Δv in the chosen frame, rotating and inertial components, model states before and after each burn).

### Model box (screens 2–4)
- Perturbation switches choose the model, and the epoch sets its phase angles.
- In ER3BP, HR4BP and the QHR4BP models the phase angles can also be set by hand. **Closest real epoch** finds
  the date in 2020–2035 whose phases are closest to the hand-set ones, so HFEM can be run with about the same
  geometry.

## Notation
| symbol | meaning |
|---|---|
| ψ₁ | position angle on a curved section boundary (lunar ellipse, L3–L4–L5 circle) [deg] |
| s | coordinate along a straight section boundary (x = const, y = 0, Earth–L4/L5 rays) [ndim] |
| ψ₂ | in-plane velocity angle, from +x in the rotating frame [deg] |
| z | height of the section point above the Earth–Moon plane [ndim] |
| ψ₃ | out-of-plane velocity angle (elevation above the Earth–Moon plane) [deg] |
| θ₁, θ₂, θ₃, f₀ | epoch phase angles of the perturbation models (QPO angles, ER3BP true anomaly) |
| C | Jacobi constant (other models: CR3BP-equivalent value at the section) |
| \|Δv\|, α, β | burn magnitude [m/s], in-plane direction, out-of-plane angle [deg] |

Burn directions:

| frame | α | β |
|---|---|---|
| VNB | measured from V towards B (0° prograde, 90° outward, 180° retrograde) | towards N, the orbit normal |
| rotating | measured from +x towards +y | towards +z |

## Dynamical models
| switch | model |
|---|---|
| none | CR3BP |
| Moon eccentricity | ER3BP |
| Sun | HR4BP |
| Sun + eccentricity | QHR4BP (eccentricity data) |
| Sun + inclination | QHR4BP (inclination data) |
| full ephemeris | HFEM: Earth, Moon and Sun point masses, JPL DE421 |

- The epoch (TDB) sets f₀, the Sun phase and the QPO angles from `public/data/phases.json`. These are the same
  per-epoch fits as the Python/MATLAB pipeline.
- HFEM uses hourly Float32 ephemeris tables, `public/data/ephem_YYYY.b64.txt`, for 2011–2012 and 2020–2035.
- Section states use the "same position + instantaneous angular rate" convention (pulsating instantaneous frame),
  so a point (ψ₁ or s, ψ₂, z, ψ₃, C) means the same physical state in every model.

## Real missions
**Missions** (header) loads Artemis I or Artemis II (NASA/JSC OEM, shipped in `public/data/missions`). **Load
a file…** loads any CCSDS OEM or JPL Horizons vector table:
- Earth- or Moon-centred;
- in km and km/s;
- with time in UTC, TAI, TT or TDB (leap seconds handled).

For a loaded mission the app shows:
- **Symbolic word**: each sample is classified at its own C. Crossings are refined by Hermite interpolation and
  bisection.
- **Crossings**: each crossing comes with (ψ₁ or s, ψ₂, z, ψ₃, C) and its section piece.
  - **Use** sets C, the word, the section point, HFEM and the epoch (to the second) from the crossing. It can
    also load the mission's maneuvers into screen 4.
  - The real trajectory is drawn in purple on the screens for comparison.
- **Maneuvers found**:
  - Detection: velocity jumps against HFEM propagation between samples, above a threshold (default 1 m/s) and
    8× the local median, each turned into one impulse at the middle of the burn.
  - Clicking one opens its Δv map with the executed Δv marked.
  - **Fit to the real trajectory** (default on): each burn is re-solved by Newton iteration in the app's own
    model. A burn after the section is solved so the trajectory passes through the real position after it; a
    burn before the section, so the trajectory passes through the real position before it.

  Artemis I with fitted burns stays within a few tens of km of the flown trajectory over three weeks. Artemis II
  stays within 1 km over 5 days.

## How it works
- **Partition** (`partition.ts`, `symbols.ts`): `classify(x, y, C)` returns one of the 14 symbols.
  `boundary.ts` lists each edge's boundary pieces that are accessible at C.
- **Propagation** (`cr3bp.ts`): DOP853 with on-line region tracking, forward or backward. It returns the word,
  the transition times and the final state. The last step lands exactly on the end time.
- **Models** (`models.ts`, `modelSetup.ts`, `icmap.ts`): each model provides its equations of motion, the
  mapping from a section point to its state, and an inertial snapshot (spacecraft, Moon, Sun).
- **Maps** (`mapEngine.ts`, `worker.ts`, `cache.ts`):
  - adaptive dyadic refinement on a worker pool, with IndexedDB checkpoints;
  - 2D maps, slices and 3D volumes all use the same engine;
  - Δv maps run through it as a *custom* map, with one state and C per grid point.
- **Maneuvers** (`maneuver.ts`):
  - A burn is an inertial velocity change applied as A⁻¹Δv, where A = dI/dx is the Jacobian of the model's
    inertial snapshot. One code path serves every model.
  - After a burn, C is updated (CR3BP: exact Jacobi; other models: the CR3BP-equivalent change of the
    pulsating speed).
  - Plans: `runPlan` (forward), `runPlanBackward` (keep the end) and `runPlanAnchored` (section fixed, past and
    future burns).
  - `prepareDvMap` precomputes the burn state, so a Δv-map point costs one linear update.
- **Missions** (`mission.ts`, `missionFit.ts`): file parsing, time scales, conversion to the section
  convention, the word and crossings, maneuver detection and Newton fitting.

## Code map
```
src/
  brand.ts              credit and funding text for the start screen
  core/
    constants.ts        CR3BP constants, libration points, partition geometry, regimes
    symbols.ts          alphabet, colours, graph layout, edges
    partition.ts        point classifier and region raster
    boundary.ts         section boundaries on any edge, accessible pieces
    section.ts          section states and default windows
    icmap.ts            section point -> initial state for each model
    cr3bp.ts            DOP853 propagation with region tracking
    dop853_coeffs.ts    integrator coefficients
    models.ts           ER3BP, HR4BP, QHR4BP, HFEM dynamics
    modelSetup.ts       building a model for an epoch, phases, closest real epoch
    words.ts            class words, prefix match, coarse alphabet
    mapEngine.ts        adaptive maps, worker pool
    worker.ts           map worker
    cache.ts            IndexedDB cache
    maneuver.ts         burns, frames, plans, Δv-map preparation
    mission.ts          OEM / Horizons parsing, mission word, crossings, maneuver detection
    missionFit.ts       fitting mission maneuvers to the real trajectory
  ui/
    App.tsx             screens, header, shared state
    Splash.tsx          start screen
    GraphView.tsx       symbolic graph
    RegionView.tsx      2D partition / trajectory view
    MapScreen.tsx       symbolic maps, legend, slices
    Volume3D.tsx        3D symbolic map
    TrajScreen.tsx      trajectory screen
    FineTune.tsx        fine-tune panel
    Traj3D.tsx          3D trajectory viewer
    ManeuverScreen.tsx  maneuver screen
    DvMap.tsx           Δv symbolic map
    MissionPanel.tsx    real missions
    ModelPanel.tsx      model and epoch box
    palette.ts          class colour schemes
    widgets.tsx, styles.css
public/
  brand/                logo, STAR Group mark, NSF logo
  data/                 ephemeris tables, phase table, QPO data
  data/missions/        Artemis I / II OEM files
tests/                  checks (run with npx tsx tests/<name>.ts)
validation/             Fig. 12 reference map from the paper
```

## Validation and tests
Run a check with `npx tsx tests/<name>.ts`:

| test | what it checks |
|---|---|
| `fig12.ts` | the paper's Fig. 12 class map (C = 3.1666, ψ₁ 181–204°, ψ₂ 17–52°): 98.7 % of 864 sampled cells match; the rest are isolated boundary cells |
| `edges.ts`, `mapping.ts`, `slice3d.ts` | section pieces on every edge, section-state mapping per model, 3D slices |
| `models_dump.ts`, `backward_dump.ts` | model and backward propagation against the Python engine. CR3BP 60/60, ER3BP 59/60, HR4BP 60/60, QHR4BP 60/60 on both datasets, HFEM 59/60. Backward QHR4BP / HFEM agree to ~1e-5 / 1e-8 |
| `maneuver.ts` | measured inertial Δv equals the request to 1e-4 m/s in every model and frame; the no-burn plan equals plain propagation; the Δv-map state equals the plan state |
| `maneuver_back.ts`, `maneuver_anchored.ts` | backward and anchored plans: the section point is kept, burns re-apply exactly (1e-12 to 1e-15), the Δv map at past burns reproduces the plan |
| `missions.ts`, `mission_fit.ts` | mission parsing and detected maneuvers; deviation from the real trajectory with fitted burns |

`tests/app_data_gen.py` regenerates `public/data` (it needs the QHR4BP Python package).

## Deployment
`.github/workflows/deploy.yml` builds the app and publishes it to GitHub Pages at every push to `main`. This
needs Settings → Pages → Source set to "GitHub Actions".

To update the site:
```
git add -A
git commit -m "describe the change"
git push
```

To embed the app in another web page:
```html
<iframe src="https://erau-star.github.io/Symbolic-Cislunar-Designer/"
        style="width:100%; height:900px; border:0;" title="Symbolic Cislunar Designer"></iframe>
```

## License
No license has been chosen yet, so all rights are reserved. Please contact the STAR Group at Embry-Riddle
Aeronautical University before reusing the code.
