# Upstream Tracking

This fork keeps official Multiwfn source updates away from `main` until a
maintainer reviews them. The daily updater writes to a dedicated branch,
currently `upstream-tracking`, and then dispatches the normal build workflow on
that branch. A maintainer can inspect the branch and manually merge or cherry
pick into `main`.

## Workflows

- `.github/workflows/track-upstream-source.yml`
  - scheduled daily and also manually runnable;
  - checks the official Multiwfn pages for Linux source archives named
    `Multiwfn_YYYY.M.D_src_Linux.zip`;
  - creates or updates `upstream-tracking`;
  - imports the official source archive into that branch;
  - commits `.multiwfn-upstream-manifest.json` with the archive URL, filename,
    SHA256, and imported file list;
  - dispatches `build.yml` on `upstream-tracking` after a successful import
    commit.
- `.github/workflows/check-upstream.yml`
  - manual diagnostic workflow only;
  - reports whether a newer official archive exists;
  - can optionally open or update an `upstream` issue.

The updater uses `GITHUB_TOKEN`. GitHub does not normally run `push` workflows
from commits made by that token, so the updater explicitly starts `build.yml`
with `workflow_dispatch` after it pushes the tracking branch.

## Branch Policy

`main` is for reviewed project work. `upstream-tracking` is for following the
official source stream and proving whether the current build/test infrastructure
still works against it.

The normal route is:

1. `track-upstream-source` detects a newer official source archive.
2. The workflow imports it into `upstream-tracking` and commits the snapshot.
3. The workflow dispatches `build.yml` on `upstream-tracking`.
4. A maintainer reviews the branch, build result, license/provenance notes, and
   any required local patch updates.
5. A maintainer opens or merges a PR into `main` manually.

Do not configure the updater to push directly to `main`. Release automation
from the tracking branch should remain prerelease/manual until the source import
and local patch boundaries have been reviewed.

## Import Behavior

The importer is `tools/upstream/import_multiwfn_source.py`. It downloads the
official Linux source zip, verifies the archive shape, imports files from the
single top-level archive directory into the repository root, and writes a
manifest:

```text
.multiwfn-upstream-manifest.json
```

On later imports, files recorded in the previous manifest but absent from the
new archive are removed. Files that are not official source files, such as
GitHub workflows, CMake files, tests, tools, and docs, are left in place.

This means `upstream-tracking` is not a pristine mirror branch. It is an
integration branch containing:

- official Multiwfn source files from the latest detected archive;
- this fork's build, packaging, CI, tests, and updater tools.

That shape is intentional: GitHub can build and test the imported source on the
tracking branch before anything reaches `main`.

## Source Snapshot Rules

- Preserve the official `LICENSE.txt` and any license text shipped in the
  source archive.
- Keep the official archive URL, filename, SHA256 hash, and imported file list
  in `.multiwfn-upstream-manifest.json`.
- Keep local build/CI/packaging changes modular so they can be reviewed apart
  from the official source import.
- If the official source layout changes enough that CMake source lists or noGUI
  stubs need adjustment, let the tracking branch build fail first, then fix it
  in a separate reviewed commit or PR.

## Manual Runs

Run the diagnostic checker locally from the repository root:

```sh
python3 tools/upstream/check_multiwfn_release.py \
  --json-out /tmp/multiwfn-upstream.json \
  --summary-out /tmp/multiwfn-upstream.md
```

Run an import locally only in a disposable branch or worktree:

```sh
python3 tools/upstream/import_multiwfn_source.py \
  --archive-url http://sobereva.com/multiwfn/misc/Multiwfn_2026.7.3_src_Linux.zip \
  --summary-out /tmp/multiwfn-import.md
```
