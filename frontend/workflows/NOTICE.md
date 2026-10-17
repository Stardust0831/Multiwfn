# BaneWfn workflow runner

The executor, standard CLI entry, module configurations, GUI recipes and moth
icon are maintained in BaneWfn by Bane Dysta:
https://github.com/bane-dysta/banewfn

`banewfn.lock.json` records their exact revision, version and file hashes.
Text transport normalizes line endings, trailing whitespace and final newlines; the ICO is copied
unchanged and the PNG is its embedded image. The standard upstream CMake core
and CLI main build `multiwfn-workflow`, the private executable shipped with this
GUI. The workbench invokes it with `--batch`; ordinary CLI calls retain their
terminal behavior. There are no local executor or recipe patches.

Update execution behavior, parameters and recipes in BaneWfn. Then refresh with:

```sh
python3 tools/sync_banewfn.py --source ../banewfn --revision COMMIT
python3 tools/sync_banewfn.py --check
```

The update uses committed files at the specified revision. It refuses to replace
local edits to locked files. Builds and CI use the checked-in snapshot offline;
they do not fetch a moving branch. Run the workflow/package checks after updates.

BaneWfn material retains Apache License 2.0 in `banewfn/LICENSE`. Include it and
the surrounding repository's `LICENSE.txt` and attribution when distributing.
Scientific calculations remain in the external Multiwfn engine.
