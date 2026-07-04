# Upstream Tracking

This fork tracks official Multiwfn source releases without letting automation
rewrite `main`. The automated part is discovery only: it checks the official
Multiwfn pages for Linux source archives named
`Multiwfn_YYYY.M.D_src_Linux.zip`, compares the newest archive with the version
currently imported in `Multiwfn.f90`, and publishes a workflow summary and
artifact. A maintainer performs the import, patch replay, review, and merge.

## Automation Scope

- Workflow: `.github/workflows/check-upstream.yml`
- Checker: `tools/upstream/check_multiwfn_release.py`
- Default upstream pages:
  - `http://sobereva.com/multiwfn/`
  - `http://sobereva.com/multiwfn/download.html`
  - `http://sobereva.com/multiwfn/misc/`
- Current version source: the `Version YYYY.M.D` string in `Multiwfn.f90`
- Output: GitHub step summary, `multiwfn-upstream-check` artifact, and, when
  explicitly enabled, an `upstream` issue for a newer source archive

The workflow has `contents: read` permission and does not commit, tag, push, or
open an automatic merge path into `main`.

Issue creation is opt-in. For a manual run, set `create_issue` to `true`. For
scheduled runs, set the repository variable `MULTIWFN_UPSTREAM_CREATE_ISSUE` to
`true`; otherwise the schedule only records the check summary and artifact.

## Branch Policy

Use a dedicated branch such as `upstream-tracking` or a prerelease branch such
as `prerelease/YYYY.M.D`. The normal route is:

1. Let the scheduled workflow or a manual `workflow_dispatch` run detect a new
   official source archive.
2. Create or update the dedicated tracking branch from the current fork state.
3. Import the official source snapshot in one commit.
4. Replay local changes as modular patch commits.
5. Run build and functional checks.
6. Open a PR from the tracking branch for human review.
7. Merge only after the official license, source provenance, and local patch
   boundaries are clear.

Never configure this workflow to push directly to `main`. If future automation
is added to download or unpack archives, it should target only the dedicated
tracking branch and should stop at opening a PR.

## Source Snapshot Import Rules

- Preserve the official `LICENSE.txt` and any license text shipped in the source
  archive.
- Keep an audit trail of the official archive URL, filename, download time, and
  SHA256 hash in the import commit message or PR description.
- Make the first import commit as close to the official archive contents as this
  repository layout allows.
- Do not mix fork-specific CMake, CI, noGUI, packaging, or documentation changes
  into the raw import commit.
- If a file is intentionally omitted from the official archive import, document
  the reason in the PR.

## Modular Patch Strategy

After the raw import commit, replay fork changes as small topic commits. Keep
the boundaries understandable:

- build system and compiler compatibility
- noGUI stubs and release packaging
- functional tests and test fixtures
- GitHub Actions changes
- documentation
- platform-specific runtime packaging

This patch shape makes it possible to compare official behavior with local
behavior, bisect regressions, and drop or rewrite one local patch without
disturbing the imported upstream snapshot.

## Manual Check

Run the checker locally from the repository root:

```sh
python3 tools/upstream/check_multiwfn_release.py \
  --json-out /tmp/multiwfn-upstream.json \
  --summary-out /tmp/multiwfn-upstream.md
```

Use `--url` to add another official index page if the source archive is moved.
Use `--current-version YYYY.M.D` to compare against a version that is not yet
reflected in `Multiwfn.f90`.

## PR or Issue Summary

When a newer archive is found, the PR or tracking issue should include:

- official archive filename and URL
- SHA256 hash of the downloaded archive
- current imported version and target upstream version
- a short list of imported, omitted, or renamed files
- local patch commits replayed after the snapshot import
- validation commands and results
- any license or redistribution notes

The release path remains prerelease/manual until the tracking PR has been
reviewed and merged by a maintainer.
