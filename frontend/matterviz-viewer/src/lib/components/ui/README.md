# Workbench UI components

These local Svelte components come from the official shadcn-svelte **Vega**
registry, retrieved on 2026-09-14:

https://www.shadcn-svelte.com/registry/styles/vega/{component}.json

Included: Button, Popover, Select, Slider, Tabs, Tooltip and Separator. The MIT
license is in `LICENSE.md`. `src/lib/utils.ts` is the matching registry utility.
`components.json` records the aliases and theme for future additions.

Local adaptations:

- Resolve the registry's utility and component import placeholders.
- Replace icon placeholders with the installed Lucide Svelte icons.
- Match Bits UI 2.19's `data-state` and `data-orientation` attributes in the
  generated utility classes; the current registry uses boolean aliases.
- Pass each slider's accessible label to its thumb and declare the tooltip
  content role explicitly.
- Omit the registry's optional translucent-menu theme hooks.

`src/ui.css` contains the compact teal/slate workbench tokens. Tailwind preflight
is deliberately omitted so it cannot reset MatterViz's native controls or its
canvas. Utility precedence is limited to elements explicitly given utility
classes. Popover and Select content is portaled above the inspector and viewer;
positioning, focus restoration, outside dismissal and keyboard behavior belong
to Bits UI.

`WorkbenchSelect.svelte` adapts the generic Select to the viewer's existing
string-valued callbacks. `WorkbenchMenu.svelte` uses a Popover because camera
and analysis panels mix buttons, numeric inputs and checkboxes.
