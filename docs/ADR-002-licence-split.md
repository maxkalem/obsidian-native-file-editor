# ADR-002: GPL-3.0-only overall, MIT in addition for src/format and src/model

Status: accepted, 2026-09-04.

## Decision

The plugin as a whole is licensed GPL-3.0-only. The directories `src/format/` and `src/model/` are additionally offered under the MIT licence, each with a `LICENSE` of its own, and nothing in them may import from anywhere else in `src/`, from Obsidian, or from the DOM. `tests/licenceBoundary.test.ts` enforces the import direction.

## Why

- The author's intent: nobody turns this code, or a piece of it, into something proprietary; donations are welcome; a renamed verbatim copy sold as somebody else's product is not. GPL-3.0 expresses that.
- The keyword tables converted from Notepad++ `langs.model.xml` come from a GPL-3.0 work. Treating a curated keyword file as uncopyrightable facts is a bet not worth making, so while those tables ship the combined work is GPL.
- The format layer (ZIP, OOXML, the legacy binary formats) is the reusable part of this project and nothing else in the ecosystem has it. Under GPL alone no MIT-licensed plugin could adopt it. The author holds all copyright in that code, so he can offer it under both licences at once.
- `-only` rather than `-or-later`: the terms do not change without the author's decision. As sole copyright holder he can widen it later; the reverse is impossible once copies are out.

## Consequences

- The Notepad++ tables live in `src/highlight/` and never move into the two MIT directories.
- Every bundled package must be redistributable inside a GPLv3 work and is listed in `THIRD_PARTY_NOTICES.md`. CodeMirror and its language packages are MIT, which is compatible.
- The licence is stated identically in `LICENSE`, `package.json`, the README and `docs/submission.md`, from the first commit.
