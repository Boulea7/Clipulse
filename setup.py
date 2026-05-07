from __future__ import annotations

import shutil
from pathlib import Path

from setuptools import setup
from setuptools.command.build_py import build_py as _build_py


REPO_ROOT = Path(__file__).resolve().parent
WEB_SOURCE_DIR = REPO_ROOT / "apps" / "web"
CONTRACTS_SOURCE_DIR = REPO_ROOT / "contracts"
WEB_BUNDLE_FILES = {
    "app.js",
    "dashboard-login.js",
    "dashboard.js",
    "dom.js",
    "formatters.js",
    "i18n.js",
    "index.html",
    "routes.js",
    "session-list-paths.js",
    "styles.css",
    "view-models.js",
}
CONTRACT_BUNDLE_SUFFIXES = {".json"}


class build_py(_build_py):
    def run(self) -> None:
        super().run()
        self._copy_named_bundle_files(WEB_SOURCE_DIR, Path("clipulse_api") / "_bundled" / "web", WEB_BUNDLE_FILES)
        self._copy_suffix_bundle_files(
            CONTRACTS_SOURCE_DIR,
            Path("clipulse_api") / "_bundled" / "contracts",
            CONTRACT_BUNDLE_SUFFIXES,
        )

    def _prepare_target_directory(
        self,
        relative_target_directory: Path,
    ) -> Path:
        target_directory = Path(self.build_lib) / relative_target_directory
        shutil.rmtree(target_directory, ignore_errors=True)
        target_directory.mkdir(parents=True, exist_ok=True)
        return target_directory

    def _copy_named_bundle_files(
        self,
        source_directory: Path,
        relative_target_directory: Path,
        included_files: set[str],
    ) -> None:
        if not source_directory.exists():
            return

        target_directory = self._prepare_target_directory(relative_target_directory)

        for file_name in sorted(included_files):
            source_file = source_directory / file_name
            if not source_file.is_file():
                continue
            shutil.copy2(source_file, target_directory / source_file.name)

    def _copy_suffix_bundle_files(
        self,
        source_directory: Path,
        relative_target_directory: Path,
        included_suffixes: set[str],
    ) -> None:
        if not source_directory.exists():
            return

        target_directory = self._prepare_target_directory(relative_target_directory)

        for source_file in source_directory.iterdir():
            if not source_file.is_file() or source_file.suffix not in included_suffixes:
                continue
            shutil.copy2(source_file, target_directory / source_file.name)


setup(cmdclass={"build_py": build_py})
