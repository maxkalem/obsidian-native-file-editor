/**
 * The build stamp: the moment `main.js` was produced, UTC, `yyMMdd.HHmm` plus
 * the milliseconds of that second (`260906.0551987`), written into the bundle
 * by esbuild (`define` in esbuild.config.mjs) and into the banner at the head
 * of main.js. It is logged at load so a person can say WHICH build is
 * running, not only which version: the version changes per release, and
 * between releases every build says "0.1.0". It is not shown in settings, on
 * the user's word. Under vitest and tsc the identifier is not defined, so
 * this reads "dev".
 */
declare const __NFE_BUILD__: string | undefined;

export const BUILD_STAMP: string = typeof __NFE_BUILD__ === "string" ? __NFE_BUILD__ : "dev";
