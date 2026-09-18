# Release engineering

Nothing is published to the community directory until the whole plan in the README is built and judged on a device. Until then, version numbers mark internal milestones and a "release" is a tag with a draft on GitHub that nobody publishes.

## Version fields, all moving together

| File | Field | Consumer |
| --- | --- | --- |
| `manifest.json` | `version` | Obsidian; must equal the release tag |
| `package.json` | `version` | npm and the CI consistency check |
| `versions.json` | new `"x.y.z": "minAppVersion"` entry | Obsidian's update mechanism; the build fails without it |

`manifest.json` is the source of truth. The esbuild config refuses to build when `package.json` disagrees or `versions.json` lacks the entry, and both workflows check the same three files.

## One source of truth, two install paths

`manifest.json` and `styles.css` are edited at the repository root only, and `main.js` is built there (the layout the community-plugins review expects). Every `npm run build` copies all three into `native-file-editor/`, the folder a person copies into `.obsidian/plugins/` for a manual install, so a manual install and a release ship byte-identical files. Never edit the files inside `native-file-editor/` by hand; they are build output, and CI fails when they differ from a fresh build. Every change under `src/` is therefore followed by `npm run build` before the commit.

`package-lock.json` is committed so `npm ci` pins the toolchain; without it an esbuild patch release would change `main.js` bytes and turn the freshness check into noise.

## Cutting a release

1. Bump the three version fields. Run `npm test`, `npm run test:e2e`, `npm run build`, `npm run size`, and commit the regenerated `main.js` and `native-file-editor/` with the version bump.
2. Tag with the bare version, no `v` prefix: `git tag 0.1.0 && git push origin main 0.1.0`. A `v`-prefixed tag does not match the workflow trigger and Obsidian's release lookup wants the bare version.
3. The `release` workflow verifies tag == manifest version, checks the three version files, runs both suites, builds, compares the committed artifacts with the build, attests provenance, and creates a **draft** release with `main.js`, `manifest.json` and `styles.css` attached. A person reviews and publishes the draft; the workflow publishes nothing.

`build-plugin.yml` runs on `pull_request` and `workflow_dispatch`, not on `push`; check the trigger lines rather than this sentence.

## Before tagging

```
jq -r .version manifest.json package.json
jq -r --arg v "$(jq -r .version manifest.json)" '.[$v]' versions.json   # == minAppVersion
jq -r '.version, .packages."".version, .packages."".license' package-lock.json
npm test && npm run test:e2e && npm run build && git status --porcelain -- main.js styles.css native-file-editor/
npm run size
```

The size report is part of every release: Obsidian loads `main.js` as one script with no code splitting, so every bundled language package is parsed at every start. A package added to the bundle is named in the release notes with the bytes it adds.

## Publishing to the community directory (once, at the end)

Publish the draft release the workflow created (a draft does not count). Sign in at community.obsidian.md, link the GitHub account that owns this repository, and submit the repository URL under Plugins, New plugin. The automated review reads `manifest.json` from the default branch; address findings by pushing fixes and cutting a new release with an incremented version. After acceptance, users receive every new GitHub release automatically.

The README, `submission.md` and `limitations.md` are what the reviewer reads. A change that invalidates one of them updates the document in the same commit.
