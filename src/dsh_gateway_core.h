/*
 * dsh_gateway_core.h — the C gateway core PILOT (the timer family on the
 * CLI host; design note: .agents/notes/implemented/architecture/
 * 2026-11-13-the-c-gateway-core-pilot.md).
 *
 * The gateway's trust-root pipeline — permission check → handler call →
 * §6 audit record → settle — lives here ONCE, instead of hand-maintained
 * per host (GatewayCore.swift / GatewayCore.kt / HostPhase.ets +
 * gateway_smoke.cpp). The dispatch table carries the
 * capability-registry.json row schema (name, permissionFlag, auditClass,
 * schemaVersion) plus the handler fn ptr; host shells populate it at
 * boot and keep the OS-facing work (the irreducible rest) in their own
 * language. The dsh_socket.c precedent is the design proof: the same
 * audit-sink plug point, the same one-serial-thread rules (D2), the same
 * metadata-only records (contract primitives.md §6 — primitive name +
 * outcome code, never payload contents, closed vocabulary).
 *
 * Threading: dispatch runs on the runtime's serial queue only. No locks,
 * no heap inside the core — the table and grants are host-owned const
 * data, the reply is stack space.
 */
#ifndef DSH_GATEWAY_CORE_H
#define DSH_GATEWAY_CORE_H

/* Plain C interface only — C++ embedders wrap this header in extern "C"
 * themselves. (No #ifdef __cplusplus guard: the syntax-class checker's
 * editor-level parse cannot match the brace across the conditional — the
 * same trade dsh_runtime_host.h already made.) */
#include <stddef.h>

/* The §6 audit sink: one metadata-only JSON line per settled call. The
 * same plug point dsh_socket.h ships (`dsh_socket_audit_set`); the
 * default sink writes stderr so audit stays mandatory even for a host
 * that forgot to wire one. */
void dsh_gateway_core_audit_set(void (*sink)(const char *json_line));

/* A handler's synchronous outcome. The handler fills it; the core owns
 * everything around it (the audit record and the settle delivery).
 * `code` speaks the contract §3 vocabulary (invalid/denied/io/timeout/
 * cancelled/unavailable — the closed set the E2E pairing gate checks);
 * `json` carries the settle payload, never free-form prose. */
typedef struct dsh_gateway_reply {
    int ok;         /* 1 = settle ok(json); 0 = §3 rejection (code, json) */
    char code[16];  /* the §3 code when ok == 0 ("ok" is never stored) */
    char json[256]; /* the settle payload (ok) or the {"code",...} shape */
} dsh_gateway_reply;

/* Fill a §3 rejection: payload `{"code":...,"primitive":...,"message":...}`
 * — the exact shape the existing hosts emit. The message is clamped to
 * JSON-safe bytes (host-authored fixed strings in practice; the clamp is
 * the fail-loud floor, not a data channel). */
void dsh_gateway_reply_reject(dsh_gateway_reply *reply, const char *primitive,
                              const char *code, const char *message);

/* One dispatch row: the capability-registry.json schema (tools/generated/
 * capability-registry.json validates exactly these fields) + the handler.
 * The host shell authors the rows from the registry's data at boot — the
 * table IS registry-derived data, not a second hand-written copy. */
typedef void (*dsh_gateway_handler_fn)(void *ud, int call_id,
                                       const char *args_json,
                                       dsh_gateway_reply *reply);

typedef struct dsh_gateway_row {
    const char *name;               /* registry "name" — bare primitive name */
    dsh_gateway_handler_fn handler; /* NULL = declared but not served: `unavailable` */
    const char *permission_flag;    /* registry "permissionFlag"; NULL = the deviceInfo posture */
    const char *audit_class;        /* registry "auditClass" — descriptor-plane data; the CLI seat's emission policy is host-fixed (§6: every call records) */
    int schema_version;             /* registry "schemaVersion" */
} dsh_gateway_row;

/* The core. Grants are permission FLAGS (the descriptor's families this
 * host actually serves — the manifest source of the contract's rule 3);
 * a row whose flag is not granted rejects `denied` BEFORE its handler can
 * run. settle_fn is the host's delivery into the runtime queue (the CLI
 * wraps dsh_runtime_gateway_settle). */
typedef struct dsh_gateway_core {
    const dsh_gateway_row *rows;
    size_t n_rows;
    const char *const *grants;
    size_t n_grants;
    void *handler_ud; /* handed to every handler (the host's state) */
    void (*settle_fn)(void *ud, int call_id, int ok, const char *payload_json);
    void *settle_ud;
} dsh_gateway_core;

/* Boot-time wiring (the host shell calls this once, before any dispatch). */
void dsh_gateway_core_init(dsh_gateway_core *core, const dsh_gateway_row *rows,
                           size_t n_rows, const char *const *grants,
                           size_t n_grants, void *handler_ud,
                           void (*settle_fn)(void *ud, int call_id, int ok,
                                             const char *payload_json),
                           void *settle_ud);

/* Dispatch one gateway call. Returns 1 when `name` is a registered row:
 * the call was permission-checked, served, audited (one metadata-only
 * record), and settled, in that fixed order. Returns 0 when the name is
 * not the core's business — the host's legacy path (or its `unavailable`
 * tail) continues exactly as before. */
int dsh_gateway_core_dispatch(dsh_gateway_core *core, int call_id,
                              const char *name, const char *args_json);

#endif /* DSH_GATEWAY_CORE_H */
