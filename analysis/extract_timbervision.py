"""Verify and safely extract the official TimberVision dataset archive."""
from __future__ import annotations

import argparse
import hashlib
import os
import stat
import zipfile
from pathlib import Path

EXPECTED_BYTES = 4_295_374_572
EXPECTED_MD5 = "05e676243e1ed50976fb0f1860ed35ee"


def extract(archive: Path, destination: Path) -> None:
    archive = archive.resolve()
    destination = destination.resolve()
    if not archive.is_file():
        raise FileNotFoundError(f"Dataset archive not found: {archive}")
    if archive.stat().st_size != EXPECTED_BYTES:
        raise ValueError(
            f"Archive size mismatch: expected {EXPECTED_BYTES} bytes, got {archive.stat().st_size}"
        )

    digest = hashlib.md5()
    with archive.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != EXPECTED_MD5:
        raise ValueError(f"Dataset checksum mismatch: {digest.hexdigest()}")

    if destination.exists() and any(destination.iterdir()):
        raise FileExistsError(f"Extraction destination is not empty: {destination}")
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()

    with zipfile.ZipFile(archive) as dataset:
        for info in dataset.infolist():
            member = Path(info.filename)
            if member.is_absolute() or ".." in member.parts:
                raise ValueError(f"Unsafe archive path: {info.filename}")
            resolved = (destination / member).resolve()
            if os.path.commonpath((str(root), str(resolved))) != str(root):
                raise ValueError(f"Archive path escapes destination: {info.filename}")
            mode = info.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise ValueError(f"Symbolic links are not allowed in archive: {info.filename}")
        dataset.extractall(destination)
    print(f"Verified and extracted TimberVision dataset to {destination}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--archive",
        type=Path,
        default=Path(__file__).parent / "data" / "timbervision" / "timbervision.zip",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parent / "data" / "timbervision" / "extracted",
    )
    args = parser.parse_args()
    extract(args.archive, args.output)


if __name__ == "__main__":
    main()
