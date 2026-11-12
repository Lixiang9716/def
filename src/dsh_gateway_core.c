/*
 * dsh_gateway_core.c — the C gateway core PILOT: the dispatch pipeline
 * (permission check → handler call → §6 audit record → settle) for the
 * rows the host shell registers, currently the timer family on the CLI
 * host. See dsh_gateway_core.h for the contract and the design note.
 *
 * The audit plumbing is dsh_socket.c's design verbatim (the C spine's
 * proven pattern): a module-level sink with a stderr default, so audit is
 * mandatory even for a host that forgot to wire one (contract §6).
 */
#include "dsh_gateway_core.h"

#include <stdio.h>
#include <string.h>

/* ---- the §6 audit plane --------------------------------------------------- */

static void (*g_audit)(const char *json_line);

void dsh_gateway_core_audit_set(void (*sink)(const char *json_line)) {
    g_audit = sink;
}

static void audit_stderr(const char *json_line) {
    fprintf(stderr, "%s\n", json_line);
}

static void audit_emit(const char *json_line) {
    void (*sink)(const char *) = g_audit ? g_audit : audit_stderr;
    sink(json_line);
}

/* The record: primitive name + outcome code, never payload contents
 * (contract §6). Byte-identical to the line the platform hosts emit —
 * the E2E pairing gate reads this stream unchanged. */
static void audit_record(const char *name, const char *outcome) {
    char line[128];
    snprintf(line, sizeof(line), "{\"audit\":\"%s\",\"outcome\":\"%s\"}",
             name, outcome);
    audit_emit(line);
}

/* ---- the reply helpers ----------------------------------------------------- */

void dsh_gateway_reply_reject(dsh_gateway_reply *reply, const char *primitive,
                              const char *code, const char *message) {
    char clean[200];
    size_t o = 0;
    for (const char *p = message; *p && o + 1 < sizeof(clean); p++) {
        if (*p != '"' && *p != '\\') clean[o++] = *p;
    }
    clean[o] = 0;
    reply->ok = 0;
    snprintf(reply->code, sizeof(reply->code), "%s", code);
    snprintf(reply->json, sizeof(reply->json),
             "{\"code\":\"%s\",\"primitive\":\"%s\",\"message\":\"%s\"}",
             code, primitive, clean);
}

/* ---- the dispatch pipeline -------------------------------------------------- */

void dsh_gateway_core_init(dsh_gateway_core *core, const dsh_gateway_row *rows,
                           size_t n_rows, const char *const *grants,
                           size_t n_grants, void *handler_ud,
                           void (*settle_fn)(void *ud, int call_id, int ok,
                                             const char *payload_json),
                           void *settle_ud) {
    core->rows = rows;
    core->n_rows = n_rows;
    core->grants = grants;
    core->n_grants = n_grants;
    core->handler_ud = handler_ud;
    core->settle_fn = settle_fn;
    core->settle_ud = settle_ud;
}

static const dsh_gateway_row *row_find(const dsh_gateway_core *core,
                                       const char *name) {
    for (size_t i = 0; i < core->n_rows; i++) {
        if (strcmp(core->rows[i].name, name) == 0) return &core->rows[i];
    }
    return NULL;
}

/* The permission check: the row's flag against the host's granted flag
 * set. A NULL flag row needs nothing (the deviceInfo posture). This runs
 * BEFORE the handler — an ungranted call never reaches host code. */
static int granted(const dsh_gateway_core *core, const char *flag) {
    if (!flag) return 1;
    for (size_t i = 0; i < core->n_grants; i++) {
        if (strcmp(core->grants[i], flag) == 0) return 1;
    }
    return 0;
}

int dsh_gateway_core_dispatch(dsh_gateway_core *core, int call_id,
                              const char *name, const char *args_json) {
    const dsh_gateway_row *row = row_find(core, name);
    if (!row) return 0;
    dsh_gateway_reply reply;
    if (!granted(core, row->permission_flag)) {
        dsh_gateway_reply_reject(&reply, row->name, "denied",
                                 "permission flag not granted");
    } else if (row->handler) {
        reply.ok = 1;
        reply.code[0] = 0;
        reply.json[0] = 0;
        row->handler(core->handler_ud, call_id, args_json, &reply);
        if (reply.json[0] == 0) {
            /* fail loud (rule 5): a handler that settles nothing is the
             * bug, named — never an empty payload to the JS promise */
            dsh_gateway_reply_reject(&reply, row->name, "io",
                                     "handler produced no payload");
        }
    } else {
        dsh_gateway_reply_reject(&reply, row->name, "unavailable",
                                 "declared unavailable by the gateway core");
    }
    /* The fixed order: the record lands before the settle promise
     * resolves — the pairing gate walks the stream in call order. */
    audit_record(row->name, reply.ok ? "ok" : reply.code);
    core->settle_fn(core->settle_ud, call_id, reply.ok, reply.json);
    return 1;
}
