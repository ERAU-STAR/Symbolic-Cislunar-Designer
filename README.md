# Symbolic Cislunar Designer

Interactive symbolic trajectory design for the Earth–Moon system.

**Run it online:** https://erau-star.github.io/Symbolic-Cislunar-Designer/

Developed by Seur Gi Jo · STAR Group, Embry-Riddle Aeronautical University.
This work is supported by the National Science Foundation under ERI Award CMMI-2501408 (PI: Dr. David Canales).

## Background
The app implements the symbolic framework of

> Jo, Sahin, and Canales, "Symbolic Dynamics of Cislunar Transport: Graphs, Entropy, and Trajectory
> Families," AAS 27-530, 37th AAS/AIAA Space Flight Mechanics Meeting, New Orleans, Louisiana,
> January 17–21, 2027.

A journal article on this program is in preparation.

The framework works like this:
- The Earth–Moon plane is divided into 14 regions, called *symbols*.
- A trajectory is encoded by the sequence of regions it visits, called its *word*. For example, E_R M_L M_T1 …
  is a trajectory that leaves the Earth region on the Moon side, enters the lunar region from the L1 side and
  moves to the upper-left lunar sub-region.
- Which transitions are possible depends on the Jacobi constant C. For each energy regime they form a directed
  graph, G(1) … G(9).
- On a section (a boundary between two regions), the initial conditions that produce the same word form
  connected regions. This is the *symbolic map*. A trajectory family is a class of words, and its region on the
  map shows where that family can be reached and how robust it is.

The app turns this into a design workflow:

1. choose the word you want;
2. map where on the section it is realised;
3. open, inspect and fine-tune a trajectory;
4. modify it with impulsive maneuvers, and see how each Δv changes the word.

It covers six dynamical models, from the CR3BP to a full ephemeris model, and it can read real mission
ephemerides. A flown trajectory (for example Artemis I) can therefore be placed on the same maps and redesigned
from its real state.

All computation runs in the browser, using Web Workers for the maps. Nothing is sent to a server. Results are
cached in the browser, so a map you have computed once opens instantly the next time.

---

## Contents
- [Quick start](#quick-start)
- [The symbolic partition](#the-symbolic-partition)
- [Using the app](#using-the-app)
- [Notation](#notation)
- [Dynamical models](#dynamical-models)
- [Real missions](#real-missions)
- [How it works](#how-it-works)
- [Code map](#code-map)
- [Validation and tests](#validation-and-tests)
- [License](#license)

## Quick start
The online version needs nothing but a modern browser (Chrome, Edge, Firefox or Safari). A desktop screen is
recommended.

To run it locally (Node.js 18 or later, 22 recommended):
```
npm install
npm run dev        # development server, http://localhost:5173
npm run build      # type check + static site in dist/
npm run preview    # serve the built site, http://localhost:4173
```

## The symbolic partition
Everything is in the Earth–Moon rotating frame (CR3BP units: 1 = Earth–Moon distance, 1 TU ≈ 4.348 days,
μ = 0.0121537).

| family | symbols | where |
|---|---|---|
| Lunar | M_L, M_T1, M_T2, M_B1, M_B2, M_R | inside the lunar ellipse (semi-axes 0.3275 × 0.4945 around the Moon) |
| Lunar | M_C | the Moon itself (impact) |
| Earth | E_T, E_B, E_R | inside the circle through L3, L4 and L5, outside the lunar ellipse |
| Earth | E_C | the Earth itself (impact) |
| Exterior | X_L, X_T, X_B | outside that circle |

The sub-regions are split as follows:
- **Lunar**: M_L is left of x_L1 and M_R is right of x_L2. Between L1 and L2 the ellipse is split at the Moon's
  x into the upper pair (M_T1, M_T2) and the lower pair (M_B1, M_B2).
- **Earth**: E_R is a wedge from the Earth towards the Moon. E_T is the rest of the upper half and E_B the rest
  of the lower half.
- **Exterior**: X_L is behind the Earth. X_T is the rest of the upper half and X_B the rest of the lower half.

M_L and M_R only exist once the L1 or L2 neck is open (C below C_L1 or C_L2). Above that, those points belong
to the Earth or exterior regions.

As C decreases, more transitions open. The thresholds between the graph regimes G(1) … G(9) are C_L1, C_L2,
3.13711, 3.029583, 3.012508, C_L3, 3.00485 and 2.992784. Below that the plane is fully connected. The app allows
C down to 0.

**Coarse alphabet.** The paper's section maps merge M_T1 and M_B1 into M_1, and M_T2 and M_B2 into M_2. Maps
can use either this coarse alphabet or the fine one.

## Using the app
A start screen comes first; click the logo or **Start** to begin. The logo in the header takes you back to it.
The header also holds the four screens and the **Missions** panel. A status bar at the bottom shows the current
word, C and the regime.

### 1 · Word
Here you choose the energy and the word.
- **Jacobi constant C**:
  - The slider is split: its upper 80 % covers 3.25 to 2.95, where the regime changes happen, and the lower 20 %
    covers 2.95 to 0.
  - You can also type a value.
  - The zero-velocity curves (forbidden regions) and the regime thresholds update live.
- **Two views**:
  - the partition in the plane;
  - the symbolic graph of the current regime, where nodes are symbols and arrows are allowed transitions.
- **Building a word**: tap regions or nodes to build the word. Only transitions allowed at the current C can be
  added. You can remove the last symbol (Undo) or start over (Clear).
- **The section**: the transition into one symbol of the word is the section where the design starts. By
  default it is the first transition. Tap a later symbol in the word bar to move this point, called "now".
  Symbols after "now" are matched forward in time, and symbols before it are matched by backward propagation.

### 2 · Symbolic map
Here you see which initial conditions on the section realise the word.
- **Section**: any non-impact edge of the graph can be the section. Each edge belongs to one of these boundary
  curves:

  | boundary | coordinate |
  |---|---|
  | the lunar ellipse | angle ψ₁ |
  | the L3–L4–L5 circle | angle ψ₁ |
  | the lines x = x_L1, x_Moon, x_L2 and 0 | position s |
  | the line y = 0 | position s |
  | the Earth–L4 and Earth–L5 rays | position s |

  Only the pieces of the curve that separate the two regions and are accessible at C are used. Velocities are
  sampled pointing into the target region, with speed from C.
- **Axes**:
  - the default map is (ψ₁ or s, ψ₂);
  - a *slice* fixes z and ψ₃ for a spatial (3D) section;
  - the (z, ψ₃) map fixes the section point and varies height and out-of-plane angle.
- **Colouring**:
  - **Your word**: the number of symbols of your word that the trajectory realises, before and after the
    section.
  - **All classes**: the class of word that each point produces, over a horizon you choose.
    - Colour schemes: *Distinct* (default) or *By ending* (grouped by the family of the last symbol).
    - Thin class-boundary lines can be shown.
    - A class keeps its colour for the whole session, so maps from different models or epochs compare
      directly.
- **Adaptive refinement**:
  - The map is computed on a coarse grid first.
  - Only the blocks whose corners give different words are refined, level by level, so boundaries are sharp
    without computing every pixel.
  - Each level is saved in the browser (IndexedDB).
- **Navigation**:
  - type the window limits, or draw a zoom box;
  - zoom out, or go back to the previous view;
  - the map keeps its place when you switch modes.
- **3D volume**:
  - a stack of maps, one per layer of ψ₃ (or z): 7, 13 or 25 layers at 49² or 97² points each;
  - shown as voxels, either as *boundaries* (voxels whose class differs from a neighbour) or as a *cloud*;
  - the selected layer is drawn as a plane and as the 2D map below;
  - click a voxel to open its trajectory.
- **Missions**: when a mission is loaded, its crossings of the current section edge are drawn as purple
  diamonds. Hover over one for its date and C.
- Click any point on the map to open its trajectory on screen 3.

### 3 · Trajectory
Here you look at the trajectory and adjust it.
- **Views**:
  - **Rotating**: the trajectory over the partition.
  - **Side (x–z)**: the out-of-plane motion.
  - **Inertial**: Earth-centred, in the epoch's Earth–Moon plane.
  - **3D** (three.js): the trajectory coloured by region, the zero-velocity surface, the section, the lunar
    ellipse cylinder and the L3–L4–L5 circle. In the inertial frame it also shows the Moon's path and the Sun
    direction. Cameras: 3D, x–y, x–z or y–z; centred on the Earth–Moon system (default) or on the Moon.
- **Word timeline**: every symbol with its time. Symbols before "now" come from backward propagation. Clicking
  a symbol jumps the time slider there.
- **Fine-tune**:
  - a small symbolic map around the point; drag on it to move the point;
  - −/+ nudges for ψ₁ / s, ψ₂, z and ψ₃, with coarse, medium or fine steps and a step slider;
  - or type exact values.

  The trajectory updates live.
- **Export**: the initial condition (section coordinates, model state, model, epoch) can be exported.

### 4 · Maneuvers
Here you add impulsive burns to the trajectory from screen 3 and see how they change the word.
- **Burns**:
  - each burn has a time in days from the section crossing, from −horizon to +horizon;
  - a magnitude |Δv| in m/s;
  - an in-plane direction α and an out-of-plane angle β;
  - a frame: VNB about the Moon, VNB about the Earth, or the rotating frame.
  - Values can be typed, set with sliders, or changed with −/+ buttons. The "−/+ button size" sets how much one
    press changes |Δv| and the angles.
  - Any number of burns; each can be switched off.
- **Two design modes**:
  - **The side away from the section** (default): the state at the section is fixed. A burn after it changes
    the future; a burn before it changes the past (the state before that burn is the state after it minus Δv,
    propagated backward).
  - **Only the past (keep the end)**: the trajectory after the last burn is kept, and every earlier part is
    rebuilt backward.
- **Feedback**:
  - the trajectory is re-propagated on every change, in about 1–5 ms (CR3BP) to 10–35 ms (HFEM);
  - you see the trajectory without burns, the new word with the changed symbols outlined, the total Δv, and
    C before and after each burn.
- **Δv map**: a symbolic map for the selected burn, over (α, |Δv|) at fixed β, or over (α, β) at fixed |Δv|.
  - Colours: the word after the burn (or before it, read backward, for a burn before the section), or how much
    of your word the whole trajectory realises.
  - Other burns are applied as they are, so the map shows exactly what this one burn can do.
  - Click or drag on the map to set the burn.
  - The map can be shown next to the trajectory and can follow the time slider. Clicking it then moves the
    selected burn to that time, or creates one there.
- **Export**: the plan as JSON (burn times, Δv in the chosen frame, rotating and inertial components, model
  states and C before and after each burn).

### Model box (screens 2–4)
- Perturbation switches choose the model (see [Dynamical models](#dynamical-models)).
- The epoch (date and time) sets the model's phase angles, or the ephemeris for HFEM. Buttons step it by ±1 or
  ±7 days.
- In ER3BP, HR4BP and the QHR4BP models the phase angles (f₀, θ₁, θ₂, θ₃) can also be set by hand with sliders.
  Each set of phases is cached as its own map.
- **Closest real epoch**: searches 2020–2035 for the date whose phase angles are closest to the hand-set ones.
  HFEM can then be run with about the same geometry.

## Notation
| symbol | meaning |
|---|---|
| ψ₁ | position angle on a curved section boundary (lunar ellipse, L3–L4–L5 circle) [deg] |
| s | coordinate along a straight section boundary (x = const, y = 0, Earth–L4/L5 rays) [ndim] |
| ψ₂ | in-plane velocity angle, from +x in the rotating frame [deg] |
| z | height of the section point above the Earth–Moon plane [ndim] |
| ψ₃ | out-of-plane velocity angle (elevation above the Earth–Moon plane) [deg] |
| θ₁, θ₂, θ₃, f₀ | epoch phase angles of the perturbation models (QPO angles, ER3BP true anomaly) |
| C | Jacobi constant (other models: the CR3BP-equivalent value at the section) |
| \|Δv\|, α, β | burn magnitude [m/s], in-plane direction, out-of-plane angle [deg] |

Burn directions:

| frame | α | β |
|---|---|---|
| VNB | measured from V towards B (0° prograde, 90° outward, 180° retrograde) | towards N, the orbit normal |
| rotating | measured from +x towards +y | towards +z |

In VNB, V is the velocity relative to the body (Moon or Earth), N is the orbit normal, and B = V × N.

## Dynamical models
| switch | model | phase set by the epoch |
|---|---|---|
| none | CR3BP | none |
| Moon eccentricity | ER3BP | f₀ (Moon's true anomaly) |
| Sun | HR4BP (bicircular) | θ₂ (Sun angle) |
| Sun + eccentricity | QHR4BP (eccentricity data) | θ₁, θ₂ |
| Sun + inclination | QHR4BP (inclination data) | θ₃, θ₂ |
| full ephemeris | HFEM: Earth, Moon and Sun point masses, JPL DE421 | ephemeris |

- **Phases**: for each epoch (TDB) the phases come from `public/data/phases.json`. These are the same per-epoch
  fits as the Python/MATLAB pipeline. The QHR4BP quasi-periodic data are in `qpo_ecc.json` and `qpo_inc.json`.
- **HFEM**: uses hourly Float32 ephemeris tables, `public/data/ephem_YYYY.b64.txt`, for 2011–2012 and 2020–2035.
  It can be built over any span inside them.
- **Same section point in every model**: section states use the "same position + instantaneous angular rate"
  convention in the pulsating instantaneous Earth–Moon frame. A point (ψ₁ or s, ψ₂, z, ψ₃, C) therefore means
  the same physical state in every model, and maps from different models can be compared directly.
- **Words in non-CR3BP models**: the trajectory is classified with the CR3BP partition. C is the CR3BP-equivalent
  value at the section.

## Real missions
**Missions** (header) loads a mission:
- **Built in**: Artemis I and Artemis II (NASA/JSC OEM files in `public/data/missions`).
- **Load a file…**: any CCSDS OEM or JPL Horizons vector table.
  - Earth- or Moon-centred, in km and km/s.
  - Time in UTC, TAI, TT or TDB (leap seconds are handled).
  - For Horizons, ask for a vector table (position and velocity) of the spacecraft with the Earth or the Moon
    as the centre.

The states are converted to geocentric TDB and then to the app's pulsating Earth–Moon frame. For the mission,
the panel then shows:
- **Symbolic word**: each sample is classified at its own C. The crossing times are refined by Hermite
  interpolation and bisection.
- **Crossings**: every boundary crossing with its date, edge, C and section coordinates (ψ₁ or s, ψ₂, z, ψ₃).
  Filter them by "into the lunar region", "usable as a section" or "all".
  - **Use** on a crossing sets C, the word, the section point, HFEM and the epoch (to the second) from it.
  - Screens 2–4 then start from the real state. Optionally, the mission's maneuvers are loaded into screen 4.
  - The real trajectory is drawn in purple for comparison.
- **Maneuvers found**:
  - Detection: velocity jumps against HFEM propagation between consecutive samples. A jump counts when it is
    above a threshold (default 1 m/s) and above 8× the local median. A finite burn spanning several samples
    becomes one impulse at its middle. The threshold can be changed and the detection re-run.
  - Clicking a maneuver opens screen 4 at it, with its Δv map and the executed Δv marked.
  - **Fit to the real trajectory** (default on): the detected impulses alone drift away, because the
    point-mass model differs from the real dynamics and a finite burn is not an impulse. So each burn is
    re-solved by Newton iteration in the app's own model, so that the trajectory passes through the real
    position:
    - up to 2 days after the burn, for a burn after the section;
    - up to 2 days before the burn, for a burn before the section.

    A burn with no real data to aim at is switched off.
  - Artemis I with fitted burns stays within a few tens of km of the flown trajectory over three weeks.
    Artemis II stays within 1 km over 5 days.

Limits:
- Samples close to the Earth, or in low lunar orbit, are dominated by effects the model does not include
  (atmosphere, Earth oblateness, lunar gravity field). Maneuvers detected there are not reliable; raise the
  threshold.
- Artemis I ends with "Earth impact" in the model because re-entry is atmospheric.

## How it works
- **Partition** (`partition.ts`, `symbols.ts`):
  - `classify(x, y, C)` returns one of the 14 symbols. It is identical to the classifier in the Python code
    used for the paper.
  - `boundary.ts` parametrises every boundary curve and finds each edge's pieces that are accessible at C.
- **Propagation** (`cr3bp.ts`):
  - an adaptive DOP853 integrator (8th order) with on-line region tracking, forward or backward in time;
  - it returns the word, the transition times, the final state and, on request, the samples;
  - the last step lands exactly on the end time, and impacts with the Earth or the Moon end the propagation.
- **Models** (`models.ts`, `modelSetup.ts`, `icmap.ts`): each model provides three things through one
  interface:
  - its equations of motion;
  - the mapping from a section point to its initial state;
  - an inertial snapshot (spacecraft, Moon and Sun positions).

  The screens and the maneuver code are therefore model-independent.
- **Maps** (`mapEngine.ts`, `worker.ts`, `cache.ts`):
  - adaptive dyadic refinement on a pool of Web Workers (one per CPU core);
  - each level is checkpointed in IndexedDB, keyed by the model, epoch or phases, C, section and window;
  - 2D maps, slices, 3D volumes and Δv maps all use the same engine. A Δv map is a *custom* map with one model
    state and one C per grid point.
- **Maneuvers** (`maneuver.ts`):
  - **Applying Δv**: a burn is an inertial velocity change. It is applied to the model state as A⁻¹Δv, where
    A = dI/dx is the Jacobian of the model's inertial snapshot with respect to its state. One code path
    therefore serves every model and frame.
  - **C after a burn**: in the CR3BP this is the exact Jacobi constant. In the other models it is the
    CR3BP-equivalent change of the pulsating speed.
  - **Plans**:
    - `runPlan` propagates forward;
    - `runPlanBackward` keeps the end;
    - `runPlanAnchored` keeps the section fixed, with burns both before and after it.
  - **Δv maps**: `prepareDvMap` precomputes the state at the burn and its Jacobian, so each Δv-map point costs one
    linear update plus its propagation.
- **Missions** (`mission.ts`, `missionFit.ts`):
  - file parsing and time scales;
  - conversion to the section convention;
  - the word and crossings;
  - maneuver detection;
  - Newton fitting (finite-difference Jacobian, step halving).

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
| `fig12.ts` | the paper's Fig. 12 class map (C = 3.1666, ψ₁ 181–204°, ψ₂ 17–52°): 98.7 % of 864 sampled cells give the same class; the rest are isolated boundary cells |
| `edges.ts`, `mapping.ts`, `slice3d.ts` | section pieces on every edge, section-state mapping per model, 3D slices |
| `models_dump.ts`, `backward_dump.ts` | the models against the Python engine: CR3BP 60/60, ER3BP 59/60, HR4BP 60/60, QHR4BP 60/60 on both datasets, HFEM 59/60. Backward QHR4BP / HFEM agree to ~1e-5 / 1e-8; the CR3BP backward run equals the mirrored forward run |
| `maneuver.ts` | measured inertial Δv equals the request to 1e-4 m/s in every model and frame; the no-burn plan equals plain propagation; CR3BP C after a burn equals the Jacobi constant of the new state; the Δv-map state equals the plan state |
| `maneuver_back.ts`, `maneuver_anchored.ts` | backward and anchored plans: the section point is kept, burns re-apply exactly (1e-12 to 1e-15), the Δv map at a past burn reproduces the plan |
| `missions.ts`, `mission_fit.ts` | mission parsing and detected maneuvers (Artemis I: OPF 179, DRI 111, DRDB 138, RPF 292 m/s); deviation from the real trajectory with fitted burns |

`validation/` holds the class map extracted from the paper's Fig. 12. `tests/app_data_gen.py` regenerates
`public/data` (it needs the QHR4BP Python package).

## License
Copyright © STAR Group, Embry-Riddle Aeronautical University. All rights reserved.
