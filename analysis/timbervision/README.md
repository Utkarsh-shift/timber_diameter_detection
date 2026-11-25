# TimberVision models (optional detector profile)

Uses the pretrained models from https://github.com/timbervision/timbervision (paper: arXiv:2501.07360, WACV 2025).
Profile name in the app: `timbervision-v1.0-seg` — YOLOv8-L instance segmentation, 1024 px, classes `cut` (log end face), `bound`, `side`, `trunk`.
Only the `cut` class is used: each end-face mask is fitted with an ellipse, then the normal pipeline (scale, defect metrics, grading) runs.

## Licences — read before using beyond a demo
* TimberVision code/dataset/models: **CC BY-NC-SA 4.0 (non-commercial)**.
* `ultralytics` 8.2.22 (YOLOv8): **AGPL-3.0**.
* The `.pt` weight files are Python pickles: only load files from sources you trust (these come from the authors' official GitHub release).

## Setup (the main analysis venv cannot host it: torch 2.3 needs numpy < 2)
```
python -m venv analysis/.venv-tv
analysis/.venv-tv/Scripts/python -m pip install "numpy<2" torch==2.3.0 torchvision==0.18.0 --index-url https://download.pytorch.org/whl/cpu
analysis/.venv-tv/Scripts/python -m pip install ultralytics==8.2.22 "numpy<2" opencv-python-headless fastapi uvicorn python-multipart
```
Download `yolov8l-1024-seg.pt` (and optionally `yolov8l-1024-obb.pt`) from
https://github.com/timbervision/timbervision/releases/tag/v1.0.0 into this folder.

`npm run dev` then starts `worker.py` automatically on port 5001 when the venv and weights are present.
CPU inference takes roughly 3 s per photo.

## Evaluation
`eval_timbervision.py` scores the model against the DIIF ground-truth boxes (`python eval_timbervision.py <dataset_dir> <out.json>` with the `.venv-tv` python).
