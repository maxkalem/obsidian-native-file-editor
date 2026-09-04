# ADR-003: Cover everything, yield by default

Status: accepted, 2026-09-04.

## Decision

The plugin knows every text-like extension, but at load it registers only the ones no other plugin already opens. It shows one notice naming what it left alone, and settings carry a per-extension toggle to take any of them over deliberately. The toggles are shared preferences, so the same plugin set behaves the same on every device.

## Why

`registerExtensions` overwrites another plugin's claim silently and restores it on unload, so two plugins claiming one extension produce behaviour that depends on load order and looks like a bug to the user. Obsidian's developer policy also asks authors to avoid duplicating existing functionality; a plugin that grabs extensions another plugin already serves invites exactly that review comment. Yielding costs one branch at load and answers both.

`CM Code Editor` is the plugin this rule was written for: on a vault where it is installed it keeps the code files it handles, and Native File Editor adds what it does not do.

## Consequences

- A toggle applies at the next plugin reload, not immediately; taking an extension over at runtime would be the race the rule avoids.
- The set of owners is read from Obsidian's view registry, which is not in the public typings. The reader is guarded and treats an unexpected shape as "nobody owns anything", which is the conservative failure: the plugin takes what it can rather than yielding everything.
- Extensions Obsidian itself owns (`md`, `canvas`, `base`, `pdf`, images, audio, video) are never candidates, whatever the toggle says.
- The notice repeats only when the yielded set changes, tracked per device, so it is not shown at every start.
