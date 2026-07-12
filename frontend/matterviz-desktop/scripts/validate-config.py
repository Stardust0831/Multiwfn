#!/usr/bin/env python3
"""Validate the source-only Tauri shell without requiring Rust or Tauri CLI."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import tomllib


ROOT = Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    raise SystemExit(f"validation failed: {message}")


def main() -> int:
    try:
        cargo = tomllib.loads((ROOT / "Cargo.toml").read_text(encoding="utf-8"))
        config = json.loads((ROOT / "tauri.conf.json").read_text(encoding="utf-8"))
        capabilities = json.loads(
            (ROOT / "capabilities" / "default.json").read_text(encoding="utf-8")
        )
    except (OSError, UnicodeError, json.JSONDecodeError, tomllib.TOMLDecodeError) as error:
        fail(str(error))

    package = cargo.get("package", {})
    if package.get("name") != "matterviz-desktop":
        fail("Cargo package name is not matterviz-desktop")
    if "tauri" not in cargo.get("dependencies", {}):
        fail("tauri dependency is missing")
    if "tauri-build" not in cargo.get("build-dependencies", {}):
        fail("tauri-build build dependency is missing")

    if config.get("$schema") != "https://schema.tauri.app/config/2":
        fail("tauri.conf.json is not a Tauri 2 config")
    dev_url = config.get("build", {}).get("devUrl", "")
    if not dev_url.startswith("http://127.0.0.1:"):
        fail("build.devUrl must point at the local Multiwfn service")
    if config.get("app", {}).get("windows") != []:
        fail("windows must be created by Rust for runtime URL selection")
    if capabilities.get("permissions") != []:
        fail("the default capability set must remain empty")

    source = (ROOT / "src" / "main.rs").read_text(encoding="utf-8")
    for required in (
        "MATTERVIZ_WEB_URL",
        "WebviewUrl::External",
        "--url",
        "is_loopback_host",
        '"http" if !is_loopback_host(&host)',
        '"http" | "https"',
    ):
        if required not in source:
            fail(f"src/main.rs does not contain {required}")

    print("matterviz-desktop configuration is valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
