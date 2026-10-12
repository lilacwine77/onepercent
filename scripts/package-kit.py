"""Package the active site and editable assets without archived visual studies."""
import argparse
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
DESTINATION = ROOT / "deliverables" / "one-percent-pack-kit.zip"
# Leave headroom below GitHub's 100 MiB per-file limit.
MAX_ARCHIVE_BYTES = 99 * 1024 * 1024
ACTIVE_IMAGES = [
    "hero-studio-clean", "crt-poster",
    "pack-closed", "pack-first-light", "pack-silver", "pack-anthracite",
    "pepe-all-white", "pepe-mascot-white",
]
CURRENT_BLENDER_FILES = [
    "README.md", "contract.md", "onepercent-foil-source.blend",
    "onepercent-foil-master.glb", "build_foil_source.py",
    "verify_foil_source.py", "runtime-validation.json",
    "blender-build-report.json",
]
CRT_BLENDER_FILES = [
    "README.md", "contract.md", "reference_notes.md", "final_report.md",
    "build_crt.py", "onepercent-crt-source.blend", "onepercent-crt-master.glb",
    "build-report.json", "metrics-authored-final.json",
    "metrics-fresh-import-final.json", "web-validation.json",
    "iteration_review.json", "texture-revision-invariants.json",
    "texture-revision-file-manifest.json", "texture-revision-fresh-import.png",
]
# Only the canonical modeling pipeline belongs in the integration kit.
EXPERIMENTAL_SCRIPTS = {
    "export-turntable-v3-master.mjs", "turntable-v3-export-entry.js",
    "turntable-v3-export.html",
}
# The six individual CRT views remain included; their duplicate montage stays
# in the source workspace so new runtime assets do not push the kit past 99 MiB.
DERIVED_EVIDENCE = {"assets/blender/crt/evidence-final-v2/contact_sheet.png"}


def collect_paths():
    files = [
        "README.md", "package.json", "package-lock.json", "index.html",
        "AGENTS.md", ".gitignore", "vite.library.config.js",
        "Dockerfile", "Caddyfile", ".dockerignore",
        "src/pack-display.js", "src/pack-display.css",
        "public/assets/pack-reference.jpg", "public/assets/pack-back.png",
        "public/assets/one-percent-pack.glb",
        "public/models/onepercent-foil.glb",
        "public/models/onepercent-carousel.glb",
        "public/models/onepercent-crt.glb", "public/assets/crt-screen.png",
        "public/assets/crt-studio-v1.bin.gz",
        "public/assets/pack-xray-coins.webp", "public/assets/pack-xray-coins.svg",
        "artifacts/v4/sticky/report.json",
    ]
    files.extend(f"public/assets/{name}.{ext}" for name in ACTIVE_IMAGES for ext in ("png", "webp"))
    files.extend(f"assets/blender/{name}" for name in CURRENT_BLENDER_FILES)
    files.extend(f"assets/blender/crt/{name}" for name in CRT_BLENDER_FILES)
    paths = {ROOT / file for file in files}
    for folder in ("src", "examples", "docs", "tests", "dist-lib", "scripts", "assets/blender/previews", "assets/blender/carousel", "assets/blender/crt/evidence-final-v2", "public/assets/tokens", "public/media"):
        paths.update(path for path in (ROOT / folder).rglob("*") if path.is_file()
                     and "__pycache__" not in path.parts and path.suffix != ".pyc"
                     and path.name not in EXPERIMENTAL_SCRIPTS
                     and path.relative_to(ROOT).as_posix() not in DERIVED_EVIDENCE)
    # Keep compact validation records; screenshots and recordings remain in the workspace.
    for folder in ("artifacts/v2", "artifacts/v3", "artifacts/v4", "artifacts/v5", "artifacts/v6", "artifacts/v7", "artifacts/cleanup-v8", "artifacts/carousel-v9", "artifacts/carousel-v10", "artifacts/carousel-volume", "artifacts/carousel-sizing", "artifacts/carousel-repair", "artifacts/crt", "artifacts/crt-v2", "artifacts/crt-v3", "artifacts/quality-v4/final", "artifacts/quality-v4/cold-final", "artifacts/quality-v4/cold-release", "artifacts/quality-v4/tv-final", "artifacts/quality-v5/final"):
        paths.update((ROOT / folder).glob("*.json"))
    for folder in ("artifacts/video-v1", "artifacts/quality-v4/video-cold"):
        paths.update((ROOT / folder).glob("*.json"))
    for folder in ("artifacts/video-speed-v2", "artifacts/video-voice-v3", "artifacts/video-intro-v4", "artifacts/video-clean-v5", "artifacts/copy-clean-v5", "artifacts/film-tv-v1", "artifacts/film-tv-v4", "artifacts/crt-film-v1", "artifacts/crt-film-v4", "artifacts/crt-startup-v1"):
        paths.update((ROOT / folder).glob("*.json"))
    for folder in ("artifacts/pack-xray", "artifacts/pack-xray-v1"):
        paths.update((ROOT / folder).glob("*.json"))
    for report in ("lifecycle-report.json", "video/report.json", "presentation/report.json"):
        paths.add(ROOT / "artifacts/crt-startup-v1/after-first-fix" / report)
    missing = [str(path.relative_to(ROOT)) for path in paths if not path.is_file()]
    if missing:
        raise FileNotFoundError("Required kit files missing: " + ", ".join(sorted(missing)))
    return sorted(paths)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="List package scope and size without writing an archive.")
    args = parser.parse_args()
    paths = collect_paths()
    source_bytes = sum(path.stat().st_size for path in paths)
    if args.dry_run:
        print(json.dumps({"files": len(paths), "uncompressedBytes": source_bytes,
                          "maxArchiveBytes": MAX_ARCHIVE_BYTES,
                          "paths": [path.relative_to(ROOT).as_posix() for path in paths]}, indent=2))
        return
    DESTINATION.parent.mkdir(exist_ok=True)
    temporary = DESTINATION.with_suffix(".zip.tmp")
    try:
        with ZipFile(temporary, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
            for path in paths:
                relative = path.relative_to(ROOT).as_posix()
                if relative.startswith("artifacts/quality-") and path.name == "carousel-report.json":
                    # Thousands of projected vertex-envelope samples are useful
                    # for local diagnosis, but overwhelm the source kit. Keep all
                    # verdicts, worst-case metrics and curvature measurements.
                    report = json.loads(path.read_text(encoding="utf-8"))
                    for run in report.get("runs", []):
                        for edition in run.get("editions", []):
                            edition.pop("samples", None)
                    report["archiveNote"] = "Per-phase sample arrays omitted from kit; run scripts/verify-carousel-presentation.mjs to regenerate them. Full original report retained in the source workspace."
                    archive.writestr(relative, json.dumps(report, indent=2))
                else:
                    archive.write(path, relative)
        archive_bytes = temporary.stat().st_size
        if archive_bytes > MAX_ARCHIVE_BYTES:
            raise RuntimeError(f"Kit is {archive_bytes:,} bytes; maximum is {MAX_ARCHIVE_BYTES:,}. Existing archive was preserved.")
        temporary.replace(DESTINATION)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    print(f"{DESTINATION.name}: {len(paths)} files, {archive_bytes:,} bytes")


if __name__ == "__main__":
    main()
