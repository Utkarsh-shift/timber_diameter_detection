"""Prepare the official TimberVision archive as a cut-only YOLO segmentation dataset."""
from __future__ import annotations

import argparse
import os
import shutil
from pathlib import Path

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}
SPLITS = ("train", "val", "test")
CUT_CLASS_ID = 0


def _find_layout(root: Path) -> tuple[Path, Path]:
    candidates = [root, *[p for p in root.iterdir() if p.is_dir()]]
    for candidate in candidates:
        image_dir = candidate / "images"
        label_dir = candidate / "labels"
        if image_dir.is_dir() and label_dir.is_dir():
            return candidate, image_dir
    raise FileNotFoundError(f"Could not find sibling images/ and labels/ folders under {root}")


def _image_map(image_root: Path) -> dict[str, Path]:
    return {
        p.relative_to(image_root).as_posix(): p
        for p in image_root.rglob("*")
        if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES
    }


def _read_split_file(path: Path, images: dict[str, Path], image_root: Path) -> list[Path]:
    by_name: dict[str, list[Path]] = {}
    for image in images.values():
        by_name.setdefault(image.name.casefold(), []).append(image)

    selected = []
    seen = set()
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        entry = raw.strip().replace("\\", "/")
        if not entry or entry.startswith("#"):
            continue
        candidate = Path(entry)
        if candidate.suffix.lower() not in IMAGE_SUFFIXES:
            candidate = candidate.with_suffix(".jpg")
        relative = candidate.as_posix().lstrip("./")
        if relative.startswith("images/"):
            relative = relative[len("images/"):]
        image = images.get(relative)
        if image is None:
            matches = by_name.get(Path(relative).name.casefold(), [])
            if len(matches) == 1:
                image = matches[0]
            elif len(matches) > 1:
                raise ValueError(f"Ambiguous image entry {entry!r} in {path}")
        if image is None:
            possible = image_root / relative
            raise FileNotFoundError(f"Split entry {entry!r} does not resolve to an image ({possible})")
        if image not in seen:
            selected.append(image)
            seen.add(image)
    return selected


def _split_images(root: Path, image_root: Path, images: dict[str, Path]) -> dict[str, list[Path]]:
    result: dict[str, list[Path]] = {}
    split_files = {split: root / f"{split}.txt" for split in SPLITS}
    if all(path.is_file() for path in split_files.values()):
        for split, path in split_files.items():
            result[split] = _read_split_file(path, images, image_root)
    elif all((image_root / split).is_dir() for split in ("train", "val")):
        for split in SPLITS:
            split_dir = image_root / split
            result[split] = sorted(
                p for p in split_dir.rglob("*")
                if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES
            ) if split_dir.is_dir() else []
    else:
        raise FileNotFoundError(
            "Could not locate official train/val/test.txt split lists or images/train and images/val folders. "
            "Refusing to invent a random split that could leak adjacent video frames."
        )
    if not result.get("train") or not result.get("val"):
        raise ValueError("TimberVision training and validation splits must both contain images")
    return result


def _cut_label_text(label_path: Path) -> str:
    if not label_path.is_file():
        return ""
    output = []
    for line_number, raw in enumerate(label_path.read_text(encoding="utf-8-sig").splitlines(), 1):
        fields = raw.split()
        if not fields:
            continue
        try:
            class_id = int(float(fields[0]))
        except ValueError as exc:
            raise ValueError(f"Invalid class id in {label_path}:{line_number}") from exc
        if class_id != CUT_CLASS_ID:
            continue
        if len(fields) < 7 or (len(fields) - 1) % 2:
            raise ValueError(f"Malformed segmentation polygon in {label_path}:{line_number}")
        try:
            coords = [float(value) for value in fields[1:]]
        except ValueError as exc:
            raise ValueError(f"Invalid polygon coordinate in {label_path}:{line_number}") from exc
        if any(value < 0 or value > 1 for value in coords):
            raise ValueError(f"Non-normalized polygon coordinate in {label_path}:{line_number}")
        output.append("0 " + " ".join(fields[1:]))
    return "\n".join(output) + ("\n" if output else "")


def _link_or_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)


def prepare(source_root: Path, output_root: Path) -> dict:
    source_root = source_root.resolve()
    output_root = output_root.resolve()
    dataset_root, image_root = _find_layout(source_root)
    label_root = dataset_root / "labels"
    images = _image_map(image_root)
    if not images:
        raise ValueError(f"No supported images found under {image_root}")
    splits = _split_images(dataset_root, image_root, images)
    if output_root.exists() and any(output_root.iterdir()):
        raise FileExistsError(
            f"Prepared dataset destination is not empty: {output_root}. "
            "Choose a new --output folder; existing data is not overwritten."
        )

    counts = {}
    for split, split_images in splits.items():
        image_count = 0
        cut_instances = 0
        images_dir = output_root / "images" / split
        labels_dir = output_root / "labels" / split
        for image in split_images:
            relative = image.relative_to(image_root)
            if relative.parts and relative.parts[0] == split:
                relative = Path(*relative.parts[1:])
            image_destination = images_dir / relative
            label_destination = labels_dir / relative.with_suffix(".txt")
            source_label = label_root / image.relative_to(image_root).with_suffix(".txt")
            text = _cut_label_text(source_label)
            _link_or_copy(image, image_destination)
            label_destination.parent.mkdir(parents=True, exist_ok=True)
            label_destination.write_text(text, encoding="utf-8")
            cut_instances += len(text.splitlines())
            image_count += 1
        counts[split] = {"images": image_count, "cut_instances": cut_instances}

    yaml_lines = [
        f"path: {output_root.as_posix()}",
        "train: images/train",
        "val: images/val",
    ]
    if counts.get("test", {}).get("images", 0):
        yaml_lines.append("test: images/test")
    yaml_lines += ["names:", "  0: cut", ""]
    yaml_path = output_root / "dataset.yaml"
    yaml_path.write_text("\n".join(yaml_lines), encoding="utf-8")
    return {
        "source_root": str(dataset_root),
        "output_root": str(output_root),
        "dataset_yaml": str(yaml_path),
        "splits": counts,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=Path(__file__).parent / "data" / "timbervision" / "extracted",
        help="Extracted official TimberVision dataset directory",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parent / "data" / "timbervision_cut_yolo",
        help="Destination for the one-class YOLO segmentation dataset",
    )
    args = parser.parse_args()
    print(prepare(args.source, args.output))


if __name__ == "__main__":
    main()
