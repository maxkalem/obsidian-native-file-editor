export type ViewMode = "preview" | "edit";

export type InitialModeSetting = "preview" | "edit" | "remember";

export interface OpenModeInput {
  readonly setting: InitialModeSetting;
  /** What the user last used for this file on this device, when "remember" is on. */
  readonly remembered: ViewMode | null;
  readonly sizeBytes: number;
  readonly largeFileBytes: number;
  /**
   * A text decoded by guess is not written back unasked, so it opens in
   * preview whatever the setting says; Edit goes through the read-only modal,
   * where the user confirms the encoding or takes a UTF-8 copy.
   */
  readonly lossy: boolean;
}

export interface OpenModeDecision {
  readonly mode: ViewMode;
  /**
   * True when the file is over the size threshold: it opens in preview whatever
   * the setting says, and switching to edit goes through the warning modal.
   */
  readonly large: boolean;
  readonly readOnly: boolean;
}

/**
 * Preview first is the default because it renders in under a frame for a large
 * file; the editor with its undo stack is built when asked for.
 */
export function decideOpenMode(input: OpenModeInput): OpenModeDecision {
  const large = input.sizeBytes > input.largeFileBytes;
  if (large) return { mode: "preview", large: true, readOnly: input.lossy };
  if (input.lossy) return { mode: "preview", large: false, readOnly: true };
  let mode: ViewMode;
  switch (input.setting) {
    case "edit":
      mode = "edit";
      break;
    case "remember":
      mode = input.remembered ?? "preview";
      break;
    default:
      mode = "preview";
  }
  return { mode, large: false, readOnly: input.lossy };
}
