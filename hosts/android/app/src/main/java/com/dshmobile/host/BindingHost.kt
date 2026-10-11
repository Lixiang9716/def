package com.dshmobile.host

import android.app.Activity
import android.content.Intent
import android.util.Log
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * Drives the M4 completion session (`android.capability-binding`) — the Android
 * sibling of hosts/ios SessionRuntime + GatewaySession: one C runtime on the
 * serial HandlerThread, the loopback carrier serving the embedded Web Client,
 * the REAL nine-primitive gateway through the frozen bridge, the projection
 * pushed JS → bus → WS → WebView. The outcome settles once (scenario or 180 s
 * watchdog). JS runs ONLY on the runtime thread; every settle/event hops via
 * JsRuntime.post (§6); carrier evidence rides the canonical envelope.
 *
 * The drive factory family (which scenario this launch runs) lives in
 * BindingDrives.kt — split at the code-size gate; the constructor and the
 * internal seams it drives (pump/cardSurface/start/watchdog/instance) are
 * module-internal for that file. */
class BindingHost internal constructor(
    private val activity: Activity,
    /** Carrier-side evidence scenario id + JS entry + capture label for this
     * drive. The default is the M4 binding; the real-LLM drive (`llm.live-stream`)
     * overrides them — same host flow, different scenario. */
    private val scenarioId: String = SCENARIO,
    private val entryPath: String = ENTRY,
    private val captureLabel: String = "android-capability-binding",
    /** The v0-plane Web Client this drive serves (client id + staged dir):
     * the default v0 client, or the compact creation client (the launch
     * extras select the drive). The compact flag switches the readiness
     * seam: its entry never posts bus.ready — see deliverHostHello. */
    private val clientId: String = "dsh-web-client",
    private val webRootDir: String = "webclient/web",
    private val compactLeg: Boolean = false,
    /** The BLE face's radio choice (the launch extras decide). */
    private val mockRadio: Boolean = false,
) {

    companion object {
        // The scenario table (scenario ids / entries / watchdog budgets) and
        // the drive factory family live in BindingDrives.kt — moved at the
        // code-size gate; this companion keeps the shared runtime facts.
        const val EXTRA_NOTIFY_RESPONSE = "dsh.notify.response"

        private const val TAG = "dsh.runtime"
        private const val RESULT_TAG = "dsh.runtime.result"
        private const val ENGINE_LABEL = "quickjs-ng 0.17.0"

        /** RuntimeDescriptor pre-eval: the full table available, the
         * capability plane's phased rows unavailable — conformance §7
         * (Android Keystore + SAF + camera2 make the surface real). */
        private val DESCRIPTOR: String = JSONObject()
            .put("available", JSONArray(GatewayCore.PRIMITIVES))
            .put("unavailable", JSONArray(GatewayCore.PHASED_ROWS))
            .toString()

        @Volatile internal var instance: BindingHost? = null

        /** Lifecycle entry points (null until the session is live). */
        fun dispatchPause() = instance?.lifecycle("background")
        fun dispatchResume() = instance?.lifecycle("foreground")

        /** Notification tap lands here (onNewIntent / cold onCreate). */
        fun dispatchNotifyResponse(intent: Intent?) {
            val id = intent?.getStringExtra(EXTRA_NOTIFY_RESPONSE) ?: return
            instance?.notify?.notifyResponse(id)
        }
    }

    private val carrier = CarrierServer()
    private val core = GatewayCore.create(File(activity.filesDir, "dsh"))
    private val fs = FsPrimitives(activity)
    private val http = HttpPrimitive()
    private val keychain = KeychainPrimitives(activity)
    val notify = NotifyPrimitive(activity)
    val timer = TimerPrimitive()
    private val ui = UiPrimitives(activity, fs)
    private val device = DevicePlanePrimitives(activity, fs)
    private val clipboard = ClipboardPrimitives(activity)
    private val camera = CameraPrimitives(activity, fs)
    private val ble = BlePrimitives(activity, core, if (mockRadio) MockBleRadio() else SystemBleRadio(activity))
    val mic = MicPrimitives(activity)
    private val wasm = WasmPrimitive(fs)

    /** The state-snapshot seam (GET /api/state behind the session cookie —
     * the same CarrierAPIBridge face the session seats serve): the drive
     * plane's observable state for the runner's probes. The origin line
     * below names the token + port once the carrier listens; it rides the
     * `dsh.serve` tag, never the checker stream. */
    private val apiToken = newSessionToken()
    private val apiBridge = CarrierAPIBridge(apiToken)

    private var handle: Long = 0

    /** The upstream-parity drive: arms the mock route's parity script and
     * hands the endpoint facts to the scenario over the runtime.config bus
     * delivery (set by startParity before start). */
    internal var parityMode = false

    /** The upstream-suite drive: the spec module path delivered in
     * runtime.config (set by startSuite before start). */
    internal var suiteSpec: String? = null

    /** The calendar-live drive (set by startCalendarLive before start): the
     * runtime.config delivery after begin is the scenario's GO trigger. */
    internal var calendarLive = false

    /** This drive's watchdog budget (spawn param; the default is the shared
     * 180 s — the calendar-live real-turn drive overrides it). Set by the
     * BindingDrives spawn tail, hence module-internal. */
    internal var watchdogSeconds: Long = WATCHDOG_SECONDS
    private var finished = false
    private var busReady = false
    private var hostHelloDelivered = false
    private var mountedLogged = false

    /** The /ws page pump (projection replay + the hello/slot.ack protocol +
     * the ws.* records + the host.info gate + the origin load) — extracted
     * to keep this file under the size gate; the records still ride this
     * drive's scenario id through carrierLog. */
    internal val pump = PagePump(
        activity, carrier,
        log = { event, fields -> carrierLog(event, fields) },
        onEvent = { json -> event(json) },
        runtimeReady = { handle != 0L && carrier.port != 0 },
    )

    internal fun start(onFinished: (String) -> Unit) {
        this.onFinished = onFinished
        JsRuntime.post {
            try {
                begin()
            } catch (e: Exception) {
                fail("m4 bootstrap: ${e::class.java.simpleName}: ${e.message}")
            }
        }
        android.os.Handler(activity.mainLooper).postDelayed(
            {
                if (!finished) fail("m4 watchdog: scenario did not complete in $watchdogSeconds s")
            },
            watchdogSeconds * 1000L,
        )
    }

    private var onFinished: ((String) -> Unit)? = null

    /** Runtime thread. */
    private fun begin() {
        carrierLog("client.selected", JSONObject().put("client", clientId))
        val bundle = File(activity.filesDir, "dsh")
        wireCore()
        carrier.onWSMessage = { text -> pump.ingest(text) }
        carrier.onStaticServed = { path ->
            if (!mountedLogged && (path == "/" || path.endsWith("index.html"))) {
                mountedLogged = true
                carrierLog(
                    "webclient.mounted",
                    JSONObject().put("client", clientId).put("path", "/index.html"),
                )
            }
        }
        val webRoot = File(bundle, webRootDir)
        if (parityMode) {
            MockLlmRoute.enableParityScript()
            carrier.register(CarrierRouteKind.EXACT, MockLlmRoute.PATH) { request, out ->
                MockLlmRoute.serve(request, out)
            }
        }
        carrier.start(webRoot) { /* readiness consumed below */ }
        // The drive plane's state seam: /api/state behind the session token,
        // the app block carrying this drive's card face projection (the
        // card-player leg's visible=true proof reads it mid-tick). The
        // origin-token line is the runner's harvest point — it appears once
        // the carrier listens, so the harvest polls for IT, never a clock.
        apiBridge.install(carrier)
        apiBridge.appState = {
            JSONObject().apply {
                val script = ui.scriptedApprovalFlag()
                put("scriptApproval", script ?: JSONObject.NULL)
                cardSurface?.let { put("card", it.snapshot().optJSONObject("card")) }
            }
        }
        Log.i("dsh.serve", "origin token=$apiToken port=${carrier.port}")
        val entry = File(bundle, entryPath)
        handle = JsRuntime.m4Begin(
            activity.filesDir.absolutePath, entryPath, entry.readText(), DESCRIPTOR,
            captureLabel, bridge,
        )
        if (handle == 0L) fail("m4 begin: ${JsRuntime.bindingLastError()}")
        deliverDriveConfigs(bundle)
        deliverHostHello() // in case bus.ready arrived during eval
    }

    /** The drive-specific runtime.config deliveries after begin (runtime
     * thread): the parity route facts, the suite spec, the calendar-live GO
     * trigger. Same handoff shape as the session-live drives: the scenario's
     * bus subscription is installed during eval, so a delivery lands
     * whenever it is posted after m4Begin returns. */
    private fun deliverDriveConfigs(bundle: File) {
        if (parityMode) {
            val config = JSONObject()
                .put("type", "runtime.config")
                .put("mockLlmUrl", "http://127.0.0.1:${carrier.port}/mock-llm")
                .put("apiKey", MockLlmRoute.KEY)
                .put("containerRoot", bundle.absolutePath)
            onRuntimeStatus(JsRuntime.m4BusDeliver(handle, config.toString()))
        }
        suiteSpec?.let { spec ->
            val config = JSONObject()
                .put("type", "runtime.config")
                .put("spec", "upstream-tests/$spec")
                .put("containerRoot", bundle.absolutePath)
            onRuntimeStatus(JsRuntime.m4BusDeliver(handle, config.toString()))
        }
        if (calendarLive) {
            // The GO trigger: the calendar-live scenario takes one
            // runtime.config off the bus queue and only then polls the
            // staged credential and boots the spine.
            onRuntimeStatus(
                JsRuntime.m4BusDeliver(handle, JSONObject().put("type", "runtime.config").toString()),
            )
        }
    }

    /** Full capability surface: all nine primitives real. */
    private fun wireCore() {
        fs.register(core)
        http.register(core)
        keychain.register(core)
        notify.register(core)
        ui.register(core)
        device.register(core)
        clipboard.register(core)
        camera.register(core)
        ble.register(core)

        mic.register(core)
        wasm.register(core)
        core.settleFn = { callId, ok, json ->
            JsRuntime.post {
                if (finished) return@post
                onRuntimeStatus(JsRuntime.m4Settle(handle, callId, ok, json))
            }
        }
        http.eventFn = { json -> event(json) }
        notify.emitFn = { json -> event(json) }
        timer.emitFn = { json -> event(json) }
        ble.emitFn = { json -> event(json) }
        mic.emitFn = { json -> event(json) }
        timer.register(core)
    }

    /** The card face — attached at drive construction (main), fed by the bus.
     * Attached by the BindingDrives factories, hence module-internal. */
    @Volatile internal var cardSurface: CardSurface? = null
    private val bridge = object : JsRuntime.BindingBridge {
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

    private fun busPosted(line: String) {
        val msg = try {
            JSONObject(line)
        } catch (_: Exception) {
            return
        }
        when (msg.optString("type")) {
            "bus.ready" -> {
                busReady = true
                deliverHostHello()
            }
            "ws.send" -> {
                val payload = msg.optJSONObject("payload") ?: return
                pump.record(payload.toString())
                carrier.send(payload.toString()) // CarrierServer.send is thread-safe
            }
            // The card face is main-thread confined; the bus line is not.
            "card.present", "card.state", "card.dismiss", "card.complete" -> {
                narrateCardFace(msg)
                activity.runOnUiThread { cardSurface?.handle(msg) }
            }
        }
    }

    /** The create-card drive narrates the face's own acts under its scenario
     * (card.face.presented / completed — the manifest's chain names the
     * NATIVE surface's render, a fact only this side of the bus owns); the
     * other drives' streams stay byte-shaped (their manifests pin them). */
    private fun narrateCardFace(msg: JSONObject) {
        if (scenarioId != CREATE_CARD_SCENARIO) return
        val type = msg.optString("type")
        if (type == "card.complete") {
            carrierLog("card.face.completed", JSONObject().put("id", msg.optString("id")))
        } else if (type == "card.present") {
            val face = msg.optJSONObject("card")
            val fields = JSONObject()
            fields.put("id", face?.optString("id") ?: "")
            fields.put("kind", face?.optString("kind") ?: "")
            carrierLog("card.face.presented", fields)
        }
    }

    /** host.hello → the page load starts. Delivery happens at the later of:
     * begin() returning, bus.ready, carrier listening (the announce rides
     * eval; never reentrant). The compact leg parks on host.info and opens
     * the origin on handle + port alone. */
    private fun deliverHostHello() {
        if (hostHelloDelivered || handle == 0L || carrier.port == 0) return
        if (!compactLeg && !busReady) return
        hostHelloDelivered = true
        val hello = JSONObject().put("type", "host.hello").put("port", carrier.port)
        onRuntimeStatus(JsRuntime.m4BusDeliver(handle, hello.toString()))
        val port = carrier.port
        activity.runOnUiThread { pump.loadOrigin(port) }
    }

    // ---- runtime-queue settle/event + settling --------------------------------

    private fun event(json: String) {
        JsRuntime.post {
            if (finished) return@post
            onRuntimeStatus(JsRuntime.m4Event(handle, json))
        }
    }

    /** 0 = running, 1 = pass, 2 = fail, -1 = error. */
    private fun onRuntimeStatus(status: Int) {
        when (status) {
            0 -> {}
            1 -> pass()
            2 -> fail("scenario completed with pass=false")
            else -> fail("m4 runtime: ${JsRuntime.bindingLastError()}")
        }
    }

    // ---- lifecycle + notification crossings ------------------------------------

    private fun lifecycle(state: String) {
        if (handle == 0L || finished) return
        notify.appState(state)
    }

    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == UiPrimitives.REQUEST_PICKER) ui.onPickerResult(resultCode, data)
        if (requestCode == UiPrimitives.REQUEST_MEDIA) ui.onMediaResult(resultCode, data)
        if (requestCode == DevicePlanePrimitives.REQUEST_SHARE) device.onShareResult(resultCode)
    }

    /** The capability planes' OS permission answers (mic + camera). */
    fun onRequestPermissionsResult(requestCode: Int, grantResults: IntArray) {
        mic.onPermissionResult(requestCode, grantResults)
        if (requestCode == CameraPrimitives.REQUEST_CAMERA) {
            camera.onPermissionResult(
                grantResults.isNotEmpty()
                    && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED,
            )
        }
        if (requestCode == BleConsentLayer.REQUEST_BLE) {
            // the scan/connect pair: every entry must be granted to proceed
            ble.onPermissionResult(grantResults.isNotEmpty()
                && grantResults.all { it == android.content.pm.PackageManager.PERMISSION_GRANTED })
        }
        mic.onPermissionResult(requestCode, grantResults)
    }

    // ---- settling ---------------------------------------------------------------

    /** The session token face (the SessionServe shape): SecureRandom bytes
     * spelled hex — the /api plane's cookie credential, never a constant. */
    private fun newSessionToken(): String {
        val bytes = ByteArray(16)
        java.security.SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun pass() = finish(true, "")

    private fun fail(message: String) {
        Log.i(TAG, "m4 FAIL $message")
        finish(false, message)
    }

    private fun finish(passed: Boolean, error: String) {
        if (finished) return
        finished = true
        val line = "$scenarioId ${if (passed) "PASS" else "FAIL"} | $ENGINE_LABEL" +
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

    /** One E2E record in the canonical envelope (`dsh.runtime.log:` prefix,
     * unified-logger shape) so the carrier's own events ride the same
     * checker stream as the JS scenario's. */
    private fun carrierLog(event: String, fields: JSONObject) {
        val payload = JSONObject().put("scenario", scenarioId).put("event", event)
        fields.keys().forEach { key -> payload.put(key, fields.get(key)) }
        val record = JSONObject()
            .put("level", "info")
            .put("module", "dsh.carrier")
            .put("message", "e2e")
            .put("data", JSONArray().put(payload))
        if (!BuildFlavor.keeps(record.toString())) return
        Log.i(TAG, "dsh.runtime.log: $record")
    }
}
