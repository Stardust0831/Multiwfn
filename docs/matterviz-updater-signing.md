# MatterViz updater signing

This procedure is intentionally inactive while
`frontend/matterviz-updater/trusted-keys.json` contains `[]`. Preview tag jobs
fail closed until a reviewed public key and protected signing secret exist.

## Generate the first key

Build `multiwfn-matterviz-sign` from a reviewed commit on an offline or trusted
machine. Generate the private key into a new file; the command refuses to
overwrite an existing path and does not print private material:

```bash
umask 077
multiwfn-matterviz-sign generate-key \
  --key-id matterviz-preview-2026-01 \
  --private-output matterviz-preview-2026-01.pkcs8.b64 \
  > matterviz-preview-2026-01.public.json
```

Inspect the public JSON, then add its version, key ID and public key as one
entry in `frontend/matterviz-updater/trusted-keys.json`. Never commit the
`.pkcs8.b64` file.

Store one encrypted offline backup and verify its public-key fingerprint on a
second trusted machine. The working private-key file should be removed after
the GitHub secret and backup have been verified.

## Configure GitHub

Create a protected Environment named `matterviz-preview-signing` in
`Stardust0831/Multiwfn` and configure:

- required maintainer approval;
- deployment restricted to `matterviz-preview-*` tags;
- secret `MATTERVIZ_PREVIEW_SIGNING_KEY_PKCS8_BASE64` containing only the
  base64 PKCS#8 value;
- variable `MATTERVIZ_PREVIEW_SIGNING_KEY_ID` matching the committed public
  registry entry.

The workflow passes the private key to the signing CLI through standard input.
It is never a command argument, package file, log field or uploaded artifact.
The protected job verifies each assembled package against its inventory before
signing the installed proof, rebuilds the archive, signs the final release
manifest, verifies that signature against the committed registry, and uploads
a draft release. It downloads the draft assets and checks `SHA256SUMS.txt`
before making the release visible.

## Bootstrap and validation

The first signed preview establishes the trust root and must be installed
manually. Confirm that its update control is visible, but do not claim
self-update validation from that installation alone. Publish a second signed
preview and test the complete N-to-N+1 flow on Windows, Linux and macOS with:

- a modified `settings.ini` that remains unchanged;
- an unknown sentinel file that remains unchanged;
- an added and a removed official file;
- a deliberately modified managed file and a new-path collision, both of which
  abort before writes;
- a failed launch followed by explicit rollback.

## Rotation

Rotation uses a bridge preview. First publish a preview whose embedded registry
contains both old and new public keys and sign it with the old key. After that
preview is installed, switch the protected Environment to the new private key.
Keep the old public key until supported installed previews have crossed the
bridge; removing it earlier strands those installations.
