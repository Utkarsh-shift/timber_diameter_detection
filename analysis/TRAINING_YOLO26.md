# YOLO26 segmentation training on TimberVision

This setup prepares a **single-class `cut` segmentation dataset** from the official TimberVision annotations and fine-tunes a pretrained YOLO26-L segmentation checkpoint. The initial weights are the public COCO-pretrained `yolo26l-seg.pt`; YOLOv8 TimberVision weights cannot be loaded as YOLO26 weights because the architectures differ.

## Important constraints

- The TimberVision dataset and project are licensed **CC BY-NC-SA 4.0**. This setup is for non-commercial use under that license; obtain separate permission for commercial use.
- TimberVision contains forestry and loading imagery, but not necessarily the same truck-pile scenes as the project photos. A model trained only on TimberVision should be treated as a starting point. For the target camera/pile domain, add CVAT-labeled images from that domain and preserve a separate held-out evaluation set.
- The current Windows machine has no CUDA GPU. The training script checks for CUDA and stops rather than silently attempting a very slow CPU training run.

## Dataset

The official archive is available from [Zenodo record 14825846](https://zenodo.org/records/14825846). Its size is 4,295,374,572 bytes and its MD5 checksum is `05e676243e1ed50976fb0f1860ed35ee`. The PowerShell helper downloads the archive, verifies its size and checksum, safely extracts it to `analysis/data/timbervision/extracted`, and prepares the one-class dataset:

The included `prepare_timbervision.py` reads the official train/validation/test splits (or pre-split `images/train`, `images/val`, and `images/test` folders), retains class ID 0 (`cut`), and makes a one-class YOLO segmentation dataset. It uses hard links for images when possible and does not overwrite a non-empty output folder.

```powershell
cd C:\path\to\Paper_jk\analysis
.\download_prepare_timbervision.ps1
```

The download resumes if interrupted. Check the printed image and cut-instance totals for each split before training. The generated dataset YAML is `analysis/data/timbervision_cut_yolo/dataset.yaml`.

## CUDA machine setup and training

Create a separate Python environment on the CUDA-enabled Windows or Linux machine. Install the PyTorch build recommended by [PyTorch's selector](https://pytorch.org/get-started/locally/) for that machine's CUDA driver, verify `torch.cuda.is_available()` is `True`, then install:

```powershell
python -m pip install -r requirements-yolo26.txt
python train_yolo26.py --data data\timbervision_cut_yolo\dataset.yaml
```

Defaults are `yolo26l-seg.pt`, 100 epochs, 1024-pixel images, automatic batch-size selection, and GPU 0. Override `--model`, `--epochs`, `--imgsz`, `--batch`, `--workers`, or `--device` for the GPU's memory and throughput. Ultralytics downloads the COCO-pretrained YOLO26 segmentation checkpoint on first use.

The script evaluates the best checkpoint on the official held-out `test` split after training. Training outputs and the best checkpoint are written under `analysis/runs_yolo26/timbervision-cut`.
