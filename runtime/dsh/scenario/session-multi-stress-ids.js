// dsh:logging-exempt (constants only)
/**
 * session-multi-stress-ids.js — the MULTI-SESSION INTERLEAVED STRESS leg's
 * shared identity constants (the one fact both the leg module and the
 * assertions module read; split at the code-size gate). The scripted drive
 * shape is DETERMINISTIC — the runner's mock script and the round schedule
 * fix every count here, and the manifest pins them.
 */
/** The mock server's successText — every answering turn settles it. */
export const EXPECTED_TEXT = 'Hello from upstream';
/** The scripted tool turn's owner: only this session may carry tool
 * records (the firehose fails any other session loud, in the moment). */
export const TOOL_SESSION = 's-stress-gamma';
/** The mock's scripted tool (DSH_MOCK_TOOL_NAME in the runner). */
export const TOOL_NAME = 'todo_write';
/** The boot-configured session (resumes through the config-driven start). */
export const BOOT_SESSION = 's-stress-alpha';
/** The sessions created through the spine factory in the drive leg. */
export const CREATED_SESSIONS = ['s-stress-beta', 's-stress-gamma'];
/** The session created MID-FLIGHT in round 2a. */
export const INSERTED_SESSION = 's-stress-delta';
/** Drive-side turn counts per session — the shape the recover leg's seeds
 * must reproduce exactly. Deterministic: the scripted rounds fix them. */
export const DRIVE_TURNS = {
  's-stress-alpha': 3,
  's-stress-beta': 3,
  's-stress-gamma': 3,
  's-stress-delta': 2, // inserted mid-flight in round 2a
};
export const SESSION_IDS = Object.keys(DRIVE_TURNS);
