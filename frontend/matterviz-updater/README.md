# MatterViz secure updater

This crate contains the signed prerelease protocol and the standalone updater
binary. Production embeds an empty public-key registry (`[]`) until a release
maintainer adds a versioned Ed25519 key; an empty registry deliberately fails
closed.

The maintainer signing binary never accepts a private key in an argument. Read a
PKCS#8 base64 key from standard input instead:

```text
multiwfn-matterviz-sign generate-key --key-id maintainer-1 \
  --private-output maintainer-1.pkcs8.base64
multiwfn-matterviz-sign inventory --root assembled/linux --target linux-x86_64 \
  --tag matterviz-preview-17 --output linux.install-manifest.json
cp linux.install-manifest.json assembled/linux/.multiwfn-install-manifest-v1.json
printf '%s' "$MAINTAINER_PKCS8_BASE64" | \
  multiwfn-matterviz-sign proof --manifest linux.install-manifest.json \
  --root assembled/linux \
  --key-id maintainer-1 --output assembled/linux/.multiwfn-install-proof-v1.json
multiwfn-matterviz-sign verify-proof --root assembled/linux \
  --manifest linux.install-manifest.json --registry trusted-keys.json
multiwfn-matterviz-sign build-manifest --tag matterviz-preview-17 \
  --target=linux-x86_64=Multiwfn-linux.tar.gz:linux.install-manifest.json \
  --target=macos-x86_64=Multiwfn-macos.tar.gz:macos.install-manifest.json \
  --target=windows-x86_64=Multiwfn-windows.zip:windows.install-manifest.json \
  --output release-manifest-v1.json
printf '%s' "$MAINTAINER_PKCS8_BASE64" | \
  multiwfn-matterviz-sign sign --manifest release-manifest-v1.json \
  --key-id maintainer-1 --output multiwfn-matterviz-release-manifest-v1.json
multiwfn-matterviz-sign verify --manifest multiwfn-matterviz-release-manifest-v1.json \
  --registry trusted-keys.json
```

`build-sign` combines the last two commands while still consuming the private
key only through stdin. The updater CLI supports `status --json`,
`check --json`, `stage --json`, `install --json --host-pid N --multiwfn-pid N`,
`confirm --json`, and `rollback-last --json`. It hardcodes the
`Stardust0831/Multiwfn` GitHub repository and only accepts
`matterviz-preview-<positive integer>` releases.

The proof is signed over the canonical install manifest (the file hashes for
managed files are enforced after installation; preserve-policy `settings.ini`
remains user-owned). It is included in each archive as
`.multiwfn-install-proof-v1.json`; the outer release manifest signs the final
archive digest and full install-manifest digest.
