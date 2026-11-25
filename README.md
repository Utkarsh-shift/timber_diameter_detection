# Pine OS – local demo with real photo analysis

Working demo of the Stitch "Pine OS Industrial Platform" designs (`stitch_pine_os_industrial_platform/`).
Give it a photo of a stacked log load and it detects every log end, measures it, grades it and pushes the result
through the whole platform (queue → studio → quality → report).

| Part | Stack |
|---|---|
| `frontend/` | React + Vite + Tailwind (theme from the Stitch HTML), react-router |
| `backend/` | Node/Express + SQLite (`node:sqlite`), SSE live updates, simulator for the *seeded* trucks |
| `analysis/` | Python FastAPI + OpenCV + scikit-learn: log-end detection, ellipse fitting, defect metrics, grading, camera calibration, benchmarks, real-data training/evaluation |

## Run

```
npm install
npm run dev        # API :4000, analysis :5000, web :5173
```

Open http://localhost:5173. Needs Node 22.5+ and Python 3.10+. On first start `analysis/run.js` creates `analysis/.venv`
and installs the Python packages (OpenCV, FastAPI, NumPy, SciPy) automatically; `npm run setup:py` does that step alone.
Icons/fonts come from Google Fonts (internet needed for the icon glyphs). `npm run reset` wipes the SQLite database.

## End-to-end demo

The web UI has no upload dialog; photos are analysed through the API (the Studio, Quality, Overview and Report screens then show the result):

```
curl -X POST localhost:4000/api/analyze -F "image=@samples/synthetic_pile.jpg" -F scale_mode=ref_width -F ref_width_mm=2400
curl -X POST localhost:4000/api/analyze -F "sample=truck_rear_photo.jpg"            # a bundled sample
curl -X POST localhost:4000/api/analyze -F "dataset=val/image18.JPG"                 # a real annotated photo, scored against its ground truth
```

Optional form fields: `profile` (detector profile), `scale_mode` (`ref_width` | `ref_mean` | `mm_per_px`), `ref_width_mm`, `ref_mean_mm`, `mm_per_px`, `plate`.

1. **Measurement Studio** – every detected log is an editable ellipse on the photo: nudge / resize / exclude bark / mark false positive / reset, **Add Missed** (click the image), with an audit trail.
2. **Approve & Commit** creates the printable **Report** (print / PDF / CSV).
3. **Quality** – grade distribution, defect crops of the worst log, sign-off with disposition; **Edit Thresholds** changes the grading rules for new analyses.
4. **Overview** – diameter histogram, truck status and queue include the analysed photos.
5. **Detector Models** – active profile, analysis time and service resource use.

## Companies and sign-in

Every account belongs to one company and sees only that company's trucks, logs, photos, quality sign-offs, thresholds and reports. The company comes from the server-side session (an HttpOnly cookie set at login), never from anything the browser sends; another company's truck, log or report id answers 404.

Demo accounts (password `Demo@1234`): `admin@jkpaper.com` (JK Paper) and `admin@xyzpaper.com` (XYZ Paper). Add more with `npm run adduser -w backend -- <email> "<name>" <company id> <password>` (`c1` = JK Paper, `c2` = XYZ Paper; run it without arguments to list companies). Passwords are stored as scrypt hashes, sessions last 7 days, and five wrong passwords lock an email for a minute. There is no self-service sign-up on purpose, so nobody can join a company by themselves.

Local demo only: it runs over plain http, so put it behind https (and add the `Secure` cookie flag) before exposing it.

API calls need the session cookie, e.g. `curl -c jar -H "Content-Type: application/json" -d '{"email":"admin@jkpaper.com","password":"Demo@1234"}' localhost:4000/api/auth/login` and then `curl -b jar -X POST localhost:4000/api/analyze -F "sample=synthetic_pile.jpg"`.

## How the analysis works (`analysis/`)

1. Contrast-normalise, find circle seeds (Hough on edges + distance transform of a wood-colour mask).
2. Refine each seed: 48 rays, strongest outward brightness drop → robust ellipse fit; score = edge coverage × contrast × fit residual.
3. Reject anything not wood-coloured, non-overlapping-area NMS (drops duplicates, gap circles, double-log circles), size-consistency and "must sit in a pile" filters.
4. Per log: major / minor axis, equivalent diameter, ovality, bark-rim ratio, crack length (longest dark thin ridge, % of Ø), heart-rot (dark core, % of face), confidence, occlusion.
5. Grade per log (A/B/C/reject from your thresholds) and per load. Volume and weight are **not** shown: one end-face view gives diameters only, not log length.

**Scale (mm per pixel)** cannot be known from a single photo, so you choose: known stack/bunk width (default 2400 mm), known mean diameter,
a direct mm/px value. Measured diameters are only as accurate as that assumption.

**Measured diameter is the visible end-face (under bark).**

## Real data with ground truth

Real photos + human labels come from the **DIIF log-end dataset** ([Zenodo, DOI 10.5281/zenodo.22894169](https://zenodo.org/records/22894169), CC BY 4.0 — please credit the authors):
146 in-the-wild photos with a bounding box around every visible log end (478 boxes). It is stored in `backend/data/uploads/diif_logend/`
(`python analysis/fetch_dataset.py` re-downloads it, verifies the checksum and unpacks it).

* **Analyze Photo → "Real annotated photos"** runs the pipeline on one of them and scores it against the human boxes (orange in the Studio, with precision / recall / F1 / IoU).
* `analysis/eval_real.py` evaluates a profile on all 146 photos.
* The dataset has **no physical scale**, so diameters on these photos are relative (the mean is assumed to be 130 mm); only detection is scored.
  It labels log ends but has no diameters, defects or grades.

### Measured accuracy (log-end detection, box IoU ≥ 0.5)

| Detector profile | Precision | Recall | F1 | Evaluated on |
|---|---|---|---|---|
| `v1.3-highrecall` (OpenCV, default) | 4.5 % | 20.5 % | 7.4 % | all 146 real photos |
| `v1.4-wild` (OpenCV, wide size band) | 13.6 % | 38.9 % | 20.2 % | all 146 real photos |
| **`timbervision-v1.0-seg`** (TimberVision YOLOv8-L, not trained on this data) | 55.9 % | **89.1 %** | **68.7 %** | all 146 real photos (conf ≥ 0.4) |

Matched boxes have a mean IoU of ~72 % (82 % for TimberVision). TimberVision's precision is understated: the human labels skip many small log ends it correctly finds (136 detections vs 35 labels on one photo), so recall and IoU are the more trustworthy numbers there. The hand-tuned OpenCV profiles were designed for uniform stacks of similar-size logs (a truck load) and
fail on cluttered, mixed-size, oblique or close-up photos (growth rings and grass read as logs). Pick the profile per analysis with the `profile` form field.

### Sample outputs on real photos

`samples/outputs/` holds annotated results of the three detectors on four real DIIF photos (`compare_<photo>.jpg` shows the human labels in white next to each detector; the caption gives logs found, precision and recall for that photo):

| Photo (human-labelled logs) | `v1.3-highrecall` P / R | `v1.4-wild` P / R | `timbervision-v1.0-seg` P / R |
|---|---|---|---|
| `val/image18.JPG` (35) | 10 % / 46 % | 22 % / 89 % | 24 % / 94 % |
| `train/IMG_5399.jpeg` (122, dense pile) | 42 % / 57 % | 44 % / 60 % | 44 % / 93 % |
| `train/IMG_5400.png` (25, close-up) | 0 % / 0 % | 24 % / 20 % | 72 % / 84 % |
| `train/IMG_7146.png` (18) | 15 % / 56 % | 20 % / 50 % | 64 % / 100 % |

The two OpenCV profiles break on close-ups and mixed sizes; TimberVision holds up. Its low precision on the dense pile is mostly small log ends the human labels skipped.

`python analysis/selftest.py`, `analysis/eval_sample.py` and the Models screen use a synthetic pile with exact ground truth:

| Check | Result |
|---|---|
| Log detection (460-log uniform pile), measured with the former `v1.2-balanced` profile | precision 100 %, recall ~96 % |
| Diameter error with a correct scale | ~1.6 mm MAE (≈ 1.3 %) |
| Heart-rot flag | precision 100 %, recall 95 % |
| Crack flag | precision ~70 %, recall ~73 % (heuristic) |

**Not validated:** diameter accuracy on real photos (no dataset here has measured diameters or a physical scale), and crack / rot / grade on real wood.
The two real sample photos in `samples/` are only 512 px wide, so crack / rot are not measurable there (the UI says "n/a (resolution)").

Still simulated (seeded data, no real source): the 48 pre-loaded trucks.

## TimberVision (best real-photo detector)

[TimberVision](https://github.com/timbervision/timbervision) YOLOv8-L segmentation weights run as an optional worker (`analysis/timbervision/`, own venv, ~2–3 s per photo on CPU). Pick `timbervision-v1.0-seg` in the Analyze dialog. **Licence: CC BY-NC-SA 4.0 (non-commercial); ultralytics is AGPL-3.0.** Setup and notes: `analysis/timbervision/README.md`.

## Going further

The two OpenCV profiles are classical and weak on real photos. A proper instance-segmentation network (YOLO-seg, Mask R-CNN, SAM 2 …) fine-tuned on it, would raise recall substantially. To plug one in
(YOLO-seg, Mask R-CNN, SAM 2 …), replace `detect()` in `analysis/detect.py` so it returns the same `Log` objects
(centre, semi-axes, angle, score) — the rest (grading, API, UI) stays unchanged.
