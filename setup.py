from __future__ import annotations

import shutil
from pathlib import Path

from setuptools import setup
from setuptools.command.build_py import build_py as _build_py


REPO_ROOT = Path(__file__).resolve().parent
WEB_SOURCE_DIR = REPO_ROOT / "apps" / "web"
CONTRACTS_SOURCE_DIR = REPO_ROOT / "contracts"
EXCLUDED_WEB_FILES = {"app.test.ts"}


class build_py(_build_py):
    def run(self) -> None:
        super().run()
        self._copy_bundle_tree(WEB_SOURCE_DIR, Path("clipulse_api") / "_bundled" / "web", EXCLUDED_WEB_FILES)
        self._copy_bundle_tree(CONTRACTS_SOURCE_DIR, Path("clipulse_api") / "_bundled" / "contracts")

    def _copy_bundle_tree(
        self,
        source_directory: Path,
        relative_target_directory: Path,
        excluded_files: set[str] | None = None,
    ) -> None:
        excluded = excluded_files or set()
        if not source_directory.exists():
            return

        target_directory = Path(self.build_lib) / relative_target_directory
        target_directory.mkdir(parents=True, exist_ok=True)

        for source_file in source_directory.iterdir():
            if not source_file.is_file() or source_file.name in excluded:
                continue
            shutil.copy2(source_file, target_directory / source_file.name)


setup(cmdclass={"build_py": build_py})
