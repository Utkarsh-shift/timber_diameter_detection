"""Fine-tune a pretrained YOLO26 segmentation checkpoint on TimberVision cut labels."""
from __future__ import annotations

import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data",
        type=Path,
        default=Path(__file__).parent / "data" / "timbervision_cut_yolo" / "dataset.yaml",
    )
    parser.add_argument("--model", default="yolo26l-seg.pt")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=1024)
    parser.add_argument("--batch", type=float, default=-1, help="-1 lets Ultralytics estimate a GPU-safe batch size")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--device", default="0")
    parser.add_argument("--project", default=str(Path(__file__).parent / "runs_yolo26"))
    parser.add_argument("--name", default="timbervision-cut")
    args = parser.parse_args()

    if args.epochs < 1 or args.imgsz < 32 or args.workers < 0:
        parser.error("epochs and imgsz must be positive, and workers cannot be negative")
    if not args.data.is_file():
        parser.error(f"Dataset YAML not found: {args.data}. Run prepare_timbervision.py first.")

    try:
        import torch
        from ultralytics import YOLO
    except ImportError as exc:
        parser.error(
            f"Training dependencies are missing ({exc}). Install the GPU-enabled PyTorch build "
            "for your CUDA driver, then install requirements-yolo26.txt."
        )
    if not torch.cuda.is_available():
        parser.error(
            "CUDA is not available. Full YOLO26-L segmentation training is intended for a CUDA GPU; "
            "run this script on a CUDA-enabled machine."
        )

    model = YOLO(args.model)
    model.train(
        data=str(args.data.resolve()),
        task="segment",
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        workers=args.workers,
        device=args.device,
        pretrained=True,
        patience=20,
        project=args.project,
        name=args.name,
        exist_ok=False,
        save=True,
        plots=True,
    )

    best = Path(model.trainer.best)
    if not best.is_file():
        raise FileNotFoundError(f"Training completed but best checkpoint was not found: {best}")
    print(f"Best checkpoint: {best}")

    import yaml

    dataset = yaml.safe_load(args.data.read_text(encoding="utf-8"))
    if dataset.get("test"):
        test_model = YOLO(str(best))
        metrics = test_model.val(
            data=str(args.data.resolve()),
            split="test",
            imgsz=args.imgsz,
            batch=args.batch,
            workers=args.workers,
            device=args.device,
            plots=True,
        )
        print(f"Held-out TimberVision test metrics: {metrics.results_dict}")
    else:
        print("No test split is configured; held-out evaluation was skipped.")


if __name__ == "__main__":
    main()
