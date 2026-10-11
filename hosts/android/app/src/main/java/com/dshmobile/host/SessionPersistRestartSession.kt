package com.dshmobile.host

import android.app.Activity
import android.os.Handler
import android.util.Log
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * Drives `android.session-persist.restart` (the Android restart leg of the
 * session-persistence family): the gated boot row mounts the vendored
 * @deepseek-ai/dsh-session-persistence-jsonl backend BEFORE the agent loop
 * (web-live/android-session-persist-restart.js — the shared self-staging
 * core's Android entry), and the RUNNER owns the restart: launch 1 runs the
 * create leg (one scripted turn journals the configured session, the backend
 * flush makes it durable) and this seat's verdict settles PASS — the runner
 * then FORCE-STOPS the process and relaunches the same extras, and launch 2
 * resumes the stored journal (create → force kill → relaunch → read back →
 * turn 2). No WebView: the leg has no page — the runtime half probes its own
 * read surface in-process, so the scenario's completion IS the verdict (the
 * create-card posture, not session-live's probe posture). Kotlin sibling of
 * SessionLiveSession minus the probe; JS runs ONLY on JsRuntime's
 * HandlerThread.
 */
class SessionPersistRestartSession private constructor(private val activity: Activity) {

    companion object {
        const val SCENARIO = "android.session-persist.restart"
        const val ENTRY = "web-live/android-session-persist-restart.js"
        const val CLIENT_ID = "dsh-web-official"
        // Bound, not pacing: the drive's stages carry their own deadlines;
        // 270s sits inside the runner's 300s per-launch window.
        const val WATCHDOG_SECONDS = 270

        private const val TAG = "dsh.runtime"
        private const val RESULT_TAG = "dsh.runtime.result"
        private const val ENGINE_LABEL = "quickjs-ng 0.17.0"

        /** The gateway descriptor of the restart runtime: fs + httpFetch (the
         * session-live shape); anything else settles denied — fail loud. */
        private val DESCRIPTOR: String = JSONObject()
            .put("available", JSONArray(GatewayCore.PRIMITIVES))
            .put("unavailable", JSONArray())
            .toString()

        @Volatile private var instance: SessionPersistRestartSession? = null

        /** Creates and starts the session; [onFinished] gets the verdict text. */
        fun start(activity: Activity, onFinished: (String) -> Unit): SessionPersistRestartSession {
            val session = SessionPersistRestartSession(activity)
            instance = session
            session.start(onFinished)
            return session
        }
    }

    private val carrier = CarrierServer()
    private val eventLog = CarrierEventLog(SCENARIO)
    private lateinit var plugins: CarrierPlugins
    private lateinit var bridge: CarrierAPIBridge
    private lateinit var core: GatewayCore
    private lateinit var seam: SessionLiveSeam

    private var onFinished: ((String) -> Unit)? = null
    private var handle: Long = 0
    private var finished = false
    private var token = ""

    private fun start(onFinished: (String) -> Unit) {
        this.onFinished = onFinished
        JsRuntime.post {
            try {
                begin()
            } catch (e: Exception) {
                fail("persist-restart bootstrap: ${e::class.java.simpleName}: ${e.message}")
            }
        }
        Handler(activity.mainLooper).postDelayed(
            {
                if (!finished) {
                    fail("persist-restart watchdog: drive did not complete in $WATCHDOG_SECONDS s")
                }
            },
            WATCHDOG_SECONDS * 1000L,
        )
    }

    /** Runtime thread: the route table (official dist fallback + /plugins +
     * /api + the scripted llm endpoint) — no page ever loads, the fallback
     * exists so the carrier shape matches its siblings — then the restart
     * runtime half. */
    private fun begin() {
        val files = activity.filesDir
        val staged = WebPluginsDelivery.build(File(files, "web-plugins"))
            ?: throw IllegalStateException(
                "web-plugins is not staged (the E2E runner stages it)",
            )
        token = randomToken()
        plugins = CarrierPlugins.staged(File(files, "web-plugins"))
        bridge = CarrierAPIBridge(token)
        bridge.deliverToRuntime = { msg -> deliverRuntime(msg) }
        seam = SessionLiveSeam(bridge)
        wireEvidence()
        bridge.install(carrier)
        carrier.onWSFrame = { text, path -> bridge.ingestFrame(text, path) }
        carrier.register(CarrierRouteKind.EXACT, MockLlmRoute.PATH) { request, out ->
            MockLlmRoute.serve(request, out)
        }
        carrier.start(File(files, "dsh/webclient/web")) { /* readiness below */ }
        eventLog.emit(
            "client.selected",
            JSONObject().put("client", CLIENT_ID).put("source", "launch"),
        )
        startRestartRuntime(staged)
    }

    /** The seat's serving facts this leg pins (no page traffic exists — the
     * upgrade accept is the mux bridge's own claim fold). */
    private fun wireEvidence() {
        bridge.onUpgradeAccepted = { path -> seam.observeUpgrade(path) }
    }

    /** Evals the restart entry through the frozen bridge, wires the gateway
     * (fs scope + httpFetch), and delivers runtime.config (scripted llm
     * endpoint + profile container) followed by the staged `web.plugins`.
     * Runtime thread. The container is filesDir/dsh — the session-live
     * sibling's root, durable across the force stop (pm clear is setup-only). */
    private fun startRestartRuntime(pluginsDelivery: JSONArray) {
        val bundle = File(activity.filesDir, "dsh")
        core = GatewayCore.create(bundle)
        val fs = FsPrimitives(activity)
        fs.register(core)
        val http = HttpPrimitive()
        http.register(core)
        core.settleFn = { callId, ok, json ->
            JsRuntime.post {
                if (finished) return@post
                onRuntimeStatus(JsRuntime.m4Settle(handle, callId, ok, json))
            }
        }
        http.eventFn = { json ->
            JsRuntime.post {
                if (finished) return@post
                onRuntimeStatus(JsRuntime.m4Event(handle, json))
            }
        }
        val entry = File(bundle, ENTRY)
        handle = JsRuntime.m4Begin(
            activity.filesDir.absolutePath, ENTRY, entry.readText(), DESCRIPTOR,
            "android-session-persist-restart", runtimeBridge,
        )
        if (handle == 0L) throw IllegalStateException("persist-restart begin: ${JsRuntime.bindingLastError()}")
        deliverRuntime(
            JSONObject()
                .put("type", "runtime.config")
                .put("mockLlmUrl", "http://127.0.0.1:${carrier.port}/mock-llm")
                .put("apiKey", MockLlmRoute.KEY)
                .put("containerRoot", bundle.absolutePath),
        )
        deliverRuntime(
            JSONObject().put("type", "web.plugins").put("plugins", pluginsDelivery),
        )
    }

    /** The BindingBridge the C host calls back (runtime thread): gateway calls
     * dispatch into the core; bus messages fold into the web-boot row
     * application (web.boot) or the claims seam. The scenario's completion IS
     * the verdict here (this leg has no page probe). */
    private val runtimeBridge = object : JsRuntime.BindingBridge {
        override fun onGatewayCall(callId: Int, name: String, args: String) {
            if (finished) return
            core.dispatch(callId, name, args)
        }

        override fun onBusLine(line: String) {
            if (finished) return
            val msg = try {
                JSONObject(line)
            } catch (_: Exception) {
                return
            }
            if (msg.optString("type") == "web.boot") {
                // The rows replace carrier defaults for a page that never
                // comes; folded for shape parity, nothing rendered.
            } else if (!seam.onBusMessage(msg)) {
                fail("persist-restart: unknown bus message '${msg.optString("type")}'")
            }
        }
    }

    /** Carrier → runtime: one bus delivery (any thread; hops onto the runtime
     * thread). */
    private fun deliverRuntime(msg: JSONObject) {
        JsRuntime.post {
            if (finished || handle == 0L) return@post
            val status = JsRuntime.m4BusDeliver(handle, msg.toString())
            if (status < 0) fail("persist-restart bus deliver: ${JsRuntime.bindingLastError()}")
        }
    }

    /** 0 = running, 1 = pass, 2 = fail, -1 = error (gateway settle/event).
     * The scenario's completion IS this leg's verdict — on BOTH launches
     * (create settles PASS, the runner kills; resume settles PASS, done). */
    private fun onRuntimeStatus(status: Int) {
        when (status) {
            0 -> {}
            1 -> finish(true, "")
            2 -> fail("persist-restart: scenario completed with pass=false")
            else -> fail("persist-restart runtime: ${JsRuntime.bindingLastError()}")
        }
    }

    // ---- settling ---------------------------------------------------------------

    private fun fail(message: String) {
        Log.i(TAG, "persist-restart FAIL $message")
        finish(false, message)
    }

    private fun finish(passed: Boolean, error: String) {
        if (finished) return
        finished = true
        val line = "$SCENARIO ${if (passed) "PASS" else "FAIL"} | $ENGINE_LABEL" +
            (if (error.isEmpty()) "" else " | error: $error")
        Log.i(RESULT_TAG, line)
        Log.i(RESULT_TAG, "ALL ${if (passed) "PASS" else "FAIL"}")
        if (handle != 0L) JsRuntime.m4End(handle)
        handle = 0
        carrier.stop()
        instance = null
        val verdict = line
        activity.runOnUiThread { onFinished?.invoke(verdict) }
    }

    private fun randomToken(): String {
        val bytes = ByteArray(16)
        java.security.SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
}

/** The MainActivity dispatch's landing (`--ez dsh.persistrestart`): the
 * gated spine boots with NO WebView — the runtime half self-stages (create
 * leg on a fresh container, resume leg after the runner's force stop +
 * relaunch on these same extras) and its completion is the verdict. The
 * carrier + drive read filesDir trees: materialize FIRST (runtime thread:
 * rt bundle + web-plugins), then start. */
internal const val EXTRA_RESTART = "dsh.persistrestart"

internal fun MainActivity.startPersistRestart() {
    setContentView(verdictView)
    JsRuntime.post {
        materializeBundle()
        syncAssetDir("web-plugins", File(filesDir, "web-plugins"))
        runOnUiThread {
            SessionPersistRestartSession.start(this) { verdict ->
                verdictView.text = verdict
            }
        }
    }
}
