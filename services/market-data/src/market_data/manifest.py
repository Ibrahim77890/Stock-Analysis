"""Manifests (provenance records) for raw files, and their verification."""

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

CODE_VERSION = "market-data 0.1.0"
MANIFEST_SUFFIX = ".manifest.json"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def manifest_path(raw_file: Path) -> Path:
    return raw_file.with_name(raw_file.name + MANIFEST_SUFFIX)


def write_manifest(
    raw_file: Path,
    *,
    provider: str,
    endpoint: str,
    parameters: dict,
    row_count: int,
    license_note: str,
    retrieved_at: datetime | None = None,
) -> dict:
    manifest = {
        "provider": provider,
        "endpoint": endpoint,
        "parameters": parameters,
        "retrieved_at": (retrieved_at or datetime.now(UTC)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "row_count": row_count,
        "file": raw_file.name,
        "file_sha256": sha256_file(raw_file),
        "tool_version": CODE_VERSION,
        "license_note": license_note,
    }
    manifest_path(raw_file).write_text(json.dumps(manifest, indent=2, sort_keys=True))
    return manifest


def read_manifest(raw_file: Path) -> dict:
    return json.loads(manifest_path(raw_file).read_text())


def verify_file(raw_file: Path) -> tuple[bool, str]:
    """Return (ok, message). Checks the manifest exists and the hash matches."""
    mp = manifest_path(raw_file)
    if not raw_file.exists():
        return False, f"missing raw file {raw_file}"
    if not mp.exists():
        return False, f"missing manifest for {raw_file.name}"
    expected = read_manifest(raw_file)["file_sha256"]
    actual = sha256_file(raw_file)
    if expected != actual:
        return False, f"hash mismatch for {raw_file.name}: manifest {expected[:12]}, file {actual[:12]}"
    return True, "ok"


def verify_tree(root: Path) -> list[tuple[Path, bool, str]]:
    """Verify every .parquet under root and flag orphan manifests."""
    results = []
    for raw in sorted(root.rglob("*.parquet")):
        ok, msg = verify_file(raw)
        results.append((raw, ok, msg))
    for mp in sorted(root.rglob("*" + MANIFEST_SUFFIX)):
        raw = mp.with_name(mp.name[: -len(MANIFEST_SUFFIX)])
        if not raw.exists():
            results.append((raw, False, f"orphan manifest {mp.name}"))
    return results
