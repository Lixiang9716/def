package com.dshmobile.spike

import android.app.Activity
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Drives the M3 on-device install session (`m3.android-install`) — the
 * Android twin of the on-device fetch-install proof: the loopback carrier
 * ([CarrierServer]) serves the fixture package the scenario staged through
 * the gateway fs, and the scenario installs it with installFromFetch over
 * the REAL gateway httpFetch (canonical install-fetch.js / install-
 * pipeline.js / receipt-journal.js / config-layer.js logic; the driver
 * scenario lives only in the assets bundle). JS runs ONLY on the runtime
 * thread; primitive handlers run off it and settle back via
 * SpikeRuntime.post (ARCHITECTURE.md §6). Carrier-side evidence (carrier
 * listening, packages served) rides the canonical `dsh.spike.log: `
 * envelope as scenario `m3.android-install` so one checker manifest covers
 * the whole flow. UI stages arrive as bus lines and are rendered by the
 * activity (screenshots are human evidence only, never checker inputs).
 */
class SpikeHostM3 private constructor(private val activity: Activity) {

    companion object {
        const val SCENARIO = "m3.android-install"
        const val ENTRY = "scenario/m3-android-install.js"
        const val WATCHDOG_SECONDS = 180

        private const val TAG = "dsh.spike"
        private const val RESULT_TAG = "dsh.spike.result"
        private const val ENGINE_LABEL = "quickjs-ng 0.17.0"

        /** RuntimeDescriptor pre-eval: all nine available, zero unavailable
         * — the device's honest surface (conformance §7). The install-time
         * negotiation consults exactly this descriptor. */
        private val DESCRIPTOR: String = JSONObject()
            .put("available", JSONArray(GatewayCore.PRIMITIVES))
            .put("unavailable", JSONArray())
            .toString()

        @Volatile private var instance: SpikeHostM3? = null

        /** Creates and starts the session; [onStage] appends one rendered UI
         * stage, [onFinished] gets the verdict text. */
        fun start(
            activity: Activity,
            onStage: (String) -> Unit,
            onFinished: (String) -> Unit,
        ): SpikeHostM3 {
            val host = SpikeHostM3(activity)
            instance = host
            host.start(onStage, onFinished)
            return host
        }
    }

    private val carrier = CarrierServer()
    private val core = GatewayCore.create(File(activity.filesDir, "spike"))
    private val fs = FsPrimitives(activity)
    private val http = HttpPrimitive()
    private val keychain = KeychainPrimitives(activity)
    private val notify = NotifyPrimitive(activity)
    private val ui = UiPrimitives(activity, fs)

    private var handle: Long = 0
    private var finished = false
    private var onStage: ((String) -> Unit)? = null
    private var onFinished: ((String) -> Unit)? = null

    private fun start(onStage: (String) -> Unit, onFinished: (String) -> Unit) {
        this.onStage = onStage
        this.onFinished = onFinished
        SpikeRuntime.post {
            try {
                begin()
            } catch (e: Exception) {
                fail("m3 bootstrap: ${e::class.java.simpleName}: ${e.message}")
            }
        }
        android.os.Handler(activity.mainLooper).postDelayed(
            {
                if (!finished) fail("m3 watchdog: scenario did not complete in $WATCHDOG_SECONDS s")
            },
            WATCHDOG_SECONDS * 1000L,
        )
    }

    /** Runtime thread. Wipes the install workspace for a deterministic run,
     * starts the carrier, evaluates the driver, then announces the loopback
     * endpoint as a gateway event (the scenario parks until it arrives). */
    private fun begin() {
        resetWorkspace()
        wireCore()
        carrier.onPackageGet = { name -> readPackage(name) }
        carrier.onPackageServed = { path, size ->
            carrierLog("package.served", JSONObject().put("path", path).put("bytes", size))
        }
        carrier.start(File(activity.filesDir, "spike/webclient/web")) { /* polled via port */ }
        carrierLog(
            "carrier.listening",
            JSONObject().put("transport", "tcp").put("loopback", true),
        )
        val bundle = File(activity.filesDir, "spike")
        val entry = File(bundle, ENTRY)
        handle = SpikeRuntime.m4Begin(
            activity.filesDir.absolutePath, ENTRY, entry.readText(), DESCRIPTOR, bridge,
        )
        if (handle == 0L) return fail("m3 begin: ${SpikeRuntime.m4LastError()}")
        deliverCarrierReady()
    }

    /** Deterministic evidence: previous runs' installs, receipts, journals,
     * and staged packages never leak into this run's one-to-one stream. */
    private fun resetWorkspace() {
        val root = File(activity.filesDir, "profiles/default")
        for (dir in listOf("cache", "plugins", "receipts", "e2e", "m3-install")) {
            File(root, dir).deleteRecursively()
        }
    }

    /** Full capability surface: all nine primitives real (the descriptor
     * must not promise more than the session wires — it does not). */
    private fun wireCore() {
        fs.register(core)
        http.register(core)
        keychain.register(core)
        notify.register(core)
        ui.register(core)
        core.settleFn = { callId, ok, json ->
            SpikeRuntime.post {
                if (finished) return@post
                onRuntimeStatus(SpikeRuntime.m4Settle(handle, callId, ok, json))
            }
        }
        http.eventFn = { json -> event(json) }
        notify.emitFn = { json -> event(json) }
    }

    /** The staged package bytes (app scope e2e/packages/<name>). */
    private fun readPackage(name: String): ByteArray? {
        val file = File(activity.filesDir, "profiles/default/e2e/packages/$name")
        return if (file.isFile) file.readBytes() else null
    }

    /** Runtime thread, after eval + first pump: the scenario subscribed to
     * the gateway event stream during eval, so delivery order is safe. */
    private fun deliverCarrierReady() {
        val ready = JSONObject()
            .put("event", "carrier.ready")
            .put("port", carrier.port)
            .put("loopback", true)
        event(ready.toString())
    }

    private val bridge = object : SpikeRuntime.M4Bridge {
        override fun onGatewayCall(callId: Int, name: String, args: String) {
            if (finished) return
            core.dispatch(callId, name, args)
        }

        override fun onBusLine(line: String) {
            if (finished) return
            busPosted(line)
        }
    }

    // ---- bus (runtime thread, called from C) --------------------------------

    /** UI stages ride the bus: {type:"ui", stage, lines:[...]}. Rendering
     * hops to the UI thread; the runtime thread is never blocked. */
    private fun busPosted(line: String) {
        val msg = try {
            JSONObject(line)
        } catch (_: Exception) {
            return
        }
        if (msg.optString("type") != "ui") return
        val stage = msg.optString("stage")
        val lines = msg.optJSONArray("lines") ?: return
        val text = (0 until lines.length()).joinToString("\n") { lines.getString(it) }
        val rendered = "[$stage]\n$text"
        activity.runOnUiThread {
            if (!finished) onStage?.invoke(rendered)
        }
    }

    // ---- runtime-queue events + settling --------------------------------------

    private fun event(json: String) {
        SpikeRuntime.post {
            if (finished) return@post
            onRuntimeStatus(SpikeRuntime.m4Event(handle, json))
        }
    }

    /** 0 = running, 1 = pass, 2 = fail, -1 = error. */
    private fun onRuntimeStatus(status: Int) {
        when (status) {
            0 -> {}
            1 -> pass()
            2 -> fail("scenario completed with pass=false")
            else -> fail("m3 runtime: ${SpikeRuntime.m4LastError()}")
        }
    }

    // ---- settling ---------------------------------------------------------------

    private fun pass() = finish(true, "")

    private fun fail(message: String) {
        Log.i(TAG, "m3 FAIL $message")
        finish(false, message)
    }

    private fun finish(passed: Boolean, error: String) {
        if (finished) return
        finished = true
        val line = "$SCENARIO ${if (passed) "PASS" else "FAIL"} | $ENGINE_LABEL" +
            (if (error.isEmpty()) "" else " | error: $error")
        Log.i(RESULT_TAG, line)
        Log.i(RESULT_TAG, "ALL ${if (passed) "PASS" else "FAIL"}")
        if (handle != 0L) SpikeRuntime.m4End(handle)
        handle = 0
        carrier.stop()
        instance = null
        val verdict = line
        activity.runOnUiThread { onFinished?.invoke(verdict) }
    }

    /** One E2E record in the canonical envelope (`dsh.spike.log:` prefix,
     * unified-logger shape) so the carrier's own events ride the same
     * checker stream as the JS scenario's. */
    private fun carrierLog(event: String, fields: JSONObject) {
        val payload = JSONObject().put("scenario", SCENARIO).put("event", event)
        fields.keys().forEach { key -> payload.put(key, fields.get(key)) }
        val record = JSONObject()
            .put("level", "info")
            .put("module", "dsh.carrier")
            .put("message", "e2e")
            .put("data", JSONArray().put(payload))
        Log.i(TAG, "dsh.spike.log: $record")
    }
}
