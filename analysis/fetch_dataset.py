"""Download and unpack the real annotated log-end dataset used for evaluation / training.

  python analysis/fetch_dataset.py

DIIF - Log-End Image Dataset (Zenodo, DOI 10.5281/zenodo.22894169), licence CC BY 4.0 (attribution required).
146 real photos with YOLO-format bounding boxes of every visible log end (class 0 = logend).
It is unpacked into backend/data/uploads/diif_logend/ (the zip is checksum-verified first).
"""
import hashlib
import os
import urllib.request
import zipfile

URL = "https://zenodo.org/records/22894169/files/DIIF_logend_annotated_dataset.zip?download=1"
MD5 = "d4cc4bba8f5c61d07677bd6b34c6999d"
DEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend", "data", "uploads", "diif_logend")

os.makedirs(DEST, exist_ok=True)
zip_path = os.path.join(DEST, "DIIF_logend_annotated_dataset.zip")
if not os.path.exists(os.path.join(DEST, "annotated_dataset")):
    h = hashlib.md5()
    with urllib.request.urlopen(URL, timeout=60) as r, open(zip_path, "wb") as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
            h.update(b)
    if h.hexdigest() != MD5:
        raise SystemExit(f"Checksum mismatch ({h.hexdigest()}); refusing to unpack.")
    with zipfile.ZipFile(zip_path) as z:
        for n in z.namelist():  # the archive only holds images and label text files; refuse anything that escapes DEST
            if n.startswith("/") or ".." in n.split("/"):
                raise SystemExit("Unsafe path in archive: " + n)
        z.extractall(DEST)
print("dataset ready in", os.path.abspath(DEST))
