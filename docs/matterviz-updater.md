# MatterViz prerelease updater

Status: implementation and review in progress. The updater is restricted to
`matterviz-preview-*` packages and must not be shipped in formal releases.

## Trust model

The updater accepts only release metadata for `Stardust0831/Multiwfn` and only
tags matching `matterviz-preview-<positive integer>`. It selects the highest
signed preview number greater than the installed preview. It never accepts a
repository, URL, tag, asset name or installation path supplied by WebView
content.

Each update release carries a versioned Ed25519-signed release manifest. The
signed document binds the repository, channel, release tag and, for every
supported target, the archive name, byte size, SHA-256 digest and SHA-256 digest
of the archive's install inventory. GitHub's asset digest, size and canonical
download URL are additional consistency checks; they never replace signature
verification.

Each preview archive also carries a separately signed installed-inventory
proof. It binds the repository, channel, tag, target and the full canonical
install-inventory digest without trying to include the final archive digest.
This avoids a circular hash while allowing a manually installed trust-root
preview to authenticate its own managed-file ownership. The inventory remains
signed in full; only verification of the installed `settings.ini` file content
is skipped because that file is user-owned after installation.

The updater embeds only a versioned public-key registry. Multiple public keys
are accepted to support bridge releases. Private keys must never be committed,
passed on a command line, printed, cached in an artifact or exposed to pull
request jobs.

## File ownership

Preview packages contain `.multiwfn-install-manifest-v1.json` and
`.multiwfn-install-proof-v1.json`. The inventory's normalized relative paths
are the complete set of files owned by that package version.
`settings.ini` has `preserve` policy and is installed only when absent. All
other regular package files have `managed` policy.

Before any write, the updater authenticates both installed and target
inventories and computes the complete transaction:

- unknown regular files and directories remain in place;
- an unchanged managed file may be replaced or removed;
- a modified managed file aborts the complete update;
- a target managed path occupied by an unknown file aborts the update;
- new managed files are written only at signed inventory paths;
- directories are removed only when empty.

The updater rejects absolute or traversing paths, alternate separators, case
fold collisions, duplicate paths, symbolic links, reparse points, hard links,
devices and other special files. It also applies explicit archive, entry,
expanded-size, output and timeout limits.

## Transaction and recovery

Downloading, signature verification, extraction and conflict detection finish
before the installation is changed. Installation uses a same-filesystem
staging area, per-file backups, atomic renames and a versioned journal. A
failure rolls operations back in reverse order. An interrupted transaction is
recoverable and blocks a new update until resumed or rolled back.

The detached helper waits for both MatterViz Host and Multiwfn to exit. The UI
closes visualization and asks the user to exit Multiwfn normally with `q`; it
does not kill the scientific process. Old managed files remain available until
the updated Host, control transport and frontend complete their first readiness
handshake. If that launch cannot complete, the standalone updater supports
explicit rollback.

No updater operation elevates privileges. A read-only installation reports a
clear error and remains unchanged.

## User flow

The preview UI performs only a local capability query during startup. GitHub is
contacted only after the user selects Check:

1. Check for the highest newer signed preview.
2. Download, verify, extract and preflight it.
3. Review the target version or conflicts.
4. Start installation, close WebView and exit Multiwfn normally with `q`.
5. Restart Multiwfn manually after the helper reports completion.

Formal packages omit the updater executable, install inventory and proof. Their
Host reports no update capability and the frontend renders no update control.

## Production key onboarding

Implementation CI uses ephemeral keys only. Before the first enabled preview,
the owner must generate a production Ed25519 key with the repository signing
tool, add only its public record to the repository, and store the PKCS#8 private
key in a protected GitHub Environment secret. The Environment must require
owner approval and restrict deployments to preview tags.

Keep one encrypted offline recovery copy and verify the full public-key
fingerprint through an independent channel. Rotation requires a bridge preview
that trusts both old and new public keys before signing with the new key.

The first preview containing a production trust root must be installed and
verified manually. Only a subsequent signed preview can exercise end-to-end
self-update.

Exact key-generation, Environment and rotation steps are documented in
`docs/matterviz-updater-signing.md`.
