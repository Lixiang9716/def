package com.dshmobile.host

import android.app.Activity
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * SessionServeConfig — the serving seat's staged config files, split out of
 * SessionServe (loop-z2: the timer.emitFn wiring pushed the seat class over
 * the code-size file cap; this block is cohesive, stateless, and shared, so
 * it moves whole rather than shrinking comments).
 *
 * Everything here reads the RESERVED APP SCOPE (`appScopeRoot`): the
 * user-supplied model endpoint (`llm/config.json` — the credential the
 * serving boot turns into a REAL provider route) and the marketplace opt-in
 * (`marketplace/config.json`). The parse posture is the same for both: a
 * malformed or partial file yields null rather than a half-configured
 * transport, and nothing logs key material.
 */
object SessionServeConfig {

    /** The reserved app scope's root (`FsPrimitives`: what scope "app"
     * means). The credential file and the workspace live inside it. */
    fun appScopeRoot(activity: Activity): File =
        File(activity.filesDir, "profiles/default")

    /** The user-supplied model endpoint from
     * `<filesDir>/profiles/default/llm/config.json` — the same shape and
     * location the `llm.live-stream` runner stages credentials at. A
     * malformed or partial file yields null rather than a half-configured
     * transport (the optional `models` roster counts as part of the file: a
     * malformed row voids the credential). Nothing here logs the key: a
     * credential that never reaches a record cannot leak into one. */
    fun loadCredential(activity: Activity): Credential? {
        val file = File(appScopeRoot(activity), "llm/config.json")
        val obj = try {
            JSONObject(file.readText())
        } catch (_: Exception) {
            return null
        }
        val baseUrl = obj.optString("baseUrl")
        val apiKey = obj.optString("apiKey")
        val model = obj.optString("model")
        if (baseUrl.isEmpty() || apiKey.isEmpty() || model.isEmpty()) return null
        val provider = obj.optString("provider").ifEmpty { "openai-compatible" }
        val models = readModels(obj) ?: return null
        return Credential(baseUrl, apiKey, model, provider, models)
    }

    /** The optional `models` roster (entries `{id, name}`) beside the
     * default model — the composer model dialog's selectable rows. Absent
     * → empty; present-but-malformed → null (the partial-file precedent:
     * never a half-configured transport). */
    private fun readModels(obj: JSONObject): List<Pair<String, String>>? {
        val rows = obj.optJSONArray("models") ?: return emptyList()
        val models = ArrayList<Pair<String, String>>(rows.length())
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: return null
            val id = row.optString("id")
            val name = row.optString("name")
            if (id.isEmpty() || name.isEmpty()) return null
            models.add(id to name)
        }
        return models
    }

    /** The marketplace opt-in from
     * `<filesDir>/profiles/default/marketplace/config.json` — the
     * reserved app scope, `{indexUrl: string}`: the plugin marketplace
     * resolver index the coverage plane's browse/install legs serve. A
     * malformed or missing file yields null — the boot stays unclaimed
     * (the loadCredential precedent: never a half-configured opt-in);
     * a present-but-shape-wrong url fails loud runtime-side, naming the
     * offender (upstream/web-write.js's marketplaceOf). */
    fun loadMarketplaceIndex(activity: Activity): String? {
        val file = File(appScopeRoot(activity), "marketplace/config.json")
        val obj = try {
            JSONObject(file.readText())
        } catch (_: Exception) {
            return null
        }
        val indexUrl = obj.optString("indexUrl")
        if (indexUrl.isEmpty()) return null
        return indexUrl
    }
}

/** One user-supplied model endpoint: an OpenAI-compatible base URL, its
 * key and the model id. `models` is the optional multi-model roster
 * staged beside it (empty when config.json carries none). */
data class Credential(
    val baseUrl: String,
    val apiKey: String,
    val model: String,
    val provider: String,
    val models: List<Pair<String, String>> = emptyList(),
)

/** The staged runtime config (split here at the code-size gate): the
 * mock route, the container roots, the live credential rows, and the
 * interactive flags (commands/goals/creation/presetJoin). The PRESET JOIN
 * stays OFF until the device-side join failure is fixed: arming it here
 * killed the runtime silently (every endpoint answered
 * gateway/unimplemented after boot; measured 2026-10-29) — the join path
 * (joinDefaultPreset → the mobile preset load) fails on the device for a
 * reason the boot log never surfaces; the debug round owns it. Without
 * the join the model's toolset rides the empty global layer (the
 * agent-presets warn names it) and ask_user_question is absent — the
 * plain-text ask fallback still gets the job answered. */
private fun modelsJSON(models: List<Pair<String, String>>): JSONArray = JSONArray().apply {
    for ((id, name) in models) put(JSONObject().put("id", id).put("name", name))
}

/** The skills config rows (the interactive seat's skills plane). */
private fun skillsConfig(workspace: File): JSONObject = JSONObject()
    .put("dshHome", "${workspace.absolutePath}/home")
    .put("agentsHome", "${workspace.absolutePath}/home/agents")
    .put("customSkillDirs", JSONArray().put("${workspace.absolutePath}/skills"))

/** The interactive seat's flags (commands/goals/creation/...). The PRESET
 * JOIN stays OFF until the device-side join failure is fixed: arming it
 * here killed the runtime silently (every endpoint answered
 * gateway/unimplemented after boot; measured 2026-10-29) — the join path
 * (joinDefaultPreset → the mobile preset load) fails on the device for a
 * reason the boot log never surfaces; the debug round owns it. Without
 * the join the model's toolset rides the empty global layer (the
 * agent-presets warn names it) and ask_user_question is absent — the
 * plain-text ask fallback still gets the job answered. */
private fun applyInteractiveFlags(config: JSONObject, workspace: File) {
    config
        .put("commands", true)
        .put("fullCoverage", true)
        .put("goals", true)
        .put("fileReferences", true)
        // The SESSION-PERSISTENCE gate (T-0212): `{}` = DEFAULTS (root
        // inside the pinned container, vendored 'zstd').
        .put("sessionPersistence", true)
        // The CREATION row: the present tool — the model declares
        // workspace files as deliverables.
        .put("creation", true)
        // The PRESET JOIN: armed now that the composition host plane's
        // packages stage (the 2026-10-29 silent death was the plane's
        // four npm faces missing from the staging — the first import
        // failed and the boot died before any log).
        .put("presetJoin", true)
        .put("byokModels", true)
        .put("skills", skillsConfig(workspace))
}

fun runtimeConfig(
        activity: Activity,
        workspace: File,
        credential: Credential?,
        interactive: Boolean,
        carrierPort: Int,
    ): JSONObject {
    val config = JSONObject()
        .put("type", "runtime.config")
        .put("mockLlmUrl", "http://127.0.0.1:$carrierPort/mock-llm")
        .put("apiKey", MockLlmRoute.KEY)
        .put("containerRoot", workspace.absolutePath)
        .put("fsScopeRoot", SessionServeConfig.appScopeRoot(activity).absolutePath)
    if (credential != null) {
        config
            .put("llmBaseUrl", credential.baseUrl)
            .put("llmApiKey", credential.apiKey)
            .put("llmModel", credential.model)
            .put("llmProvider", credential.provider)
        if (credential.models.isNotEmpty()) config.put("llmModels", modelsJSON(credential.models))
    }
    if (interactive) applyInteractiveFlags(config, workspace)
    // The marketplace opt-in (the plugin marketplace panel's browse/
    // install legs): present exactly when the user staged the resolver
    // config — the scenario relays it as the write surface's
    // marketplace {indexUrl} option (absent → the legs stay unclaimed).
    SessionServeConfig.loadMarketplaceIndex(activity)?.let { config.put("marketplaceIndex", it) }
    return config
}

