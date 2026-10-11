package com.dshmobile.host

import android.app.Activity
import android.webkit.WebView

/**
 * The drive factory family of [BindingHost] — which scenario this launch
 * drives, under which scenario id / entry / capture label / watchdog. Moved
 * out of BindingHost's companion at the code-size gate (the class body keeps
 * the runtime machinery; this file keeps the launch table). The factories
 * are extension functions on the companion so MainActivity's call spelling
 * (`BindingHost.startCalendarLive(...)`) is unchanged.
 *
 * Two shared tails:
 * - [drive] — the scenario-swap drives that carry no extra construction
 *   (construct, attach the pump + card face, park, start);
 * - [spawn] — the drives with per-drive overrides (watchdog budget, client
 *   id / web root, parity mode, post-construction fields).
 *
 * The card face rides EVERY drive: the spawn seat boots the FULL spine
 * (boot.js mounts dsh-create), so a plugin can mount and post card.* lines
 * mid-drive — the calendar-live leg's card is exactly that. A drive whose
 * scenario posts none carries an empty overlay (the previous asymmetry —
 * drive() attached, spawn() didn't — silently dropped the calendar card:
 * measured gaps3/android-04, plugin.calendar-plugin's card.present crossed
 * with cardSurface still null).
 */

// ---- the scenario table -----------------------------------------------------

/** The M4 binding drive. */
const val SCENARIO = "android.capability-binding"
const val ENTRY = "scenario/android-capability-binding.js"
/** The real-LLM drive. */
const val LLM_SCENARIO = "llm.live-stream.carrier"
const val LLM_ENTRY = "scenario/llm-live-stream.js"
/** The card-player drive (`card.player`): the card face's proof. */
const val CARD_PLAYER_SCENARIO = "card.player"
const val CARD_PLAYER_ENTRY = "scenario/card-player.js"
/** The create-card drive (`create.card`, the gaps3/android-01 spine seat). */
const val CREATE_CARD_SCENARIO = "create.card"
const val CREATE_CARD_ENTRY = "scenario/create-card.js"
/** The calendar-live drive (`create.calendar.live`, the gaps3/android-04 port). */
const val CALENDAR_LIVE_SCENARIO = "create.calendar.live"
const val CALENDAR_LIVE_ENTRY = "scenario/create-calendar-live.js"
/** The real-turn budget (see startCalendarLive): turn + mount within one
 * drive, headroom for a thinking model's minutes-long first byte. */
const val CALENDAR_LIVE_WATCHDOG_SECONDS = 480L
/** The upstream-parity drive. */
const val PARITY_SCENARIO = "upstream.parity"
const val PARITY_ENTRY = "scenario/upstream-parity.js"
/** The upstream-suite drive. */
const val SUITE_SCENARIO = "upstream.suite"
const val SUITE_ENTRY = "scenario/upstream-suite-leg.js"
/** The compact creation-client drive. */
const val COMPACT_SCENARIO = "android.compactweb.mount"
const val COMPACT_ENTRY = "scenario/session-mock-llm.js"
const val DEVICE_PLANE_SCENARIO = "android.device-plane"
const val DEVICE_PLANE_ENTRY = "scenario/device-plane.js"
const val CAMERA_PLANE_SCENARIO = "android.camera-plane"
const val CAMERA_PLANE_ENTRY = "scenario/camera-plane.js"
const val BLE_SCENARIO = "android.ble-plane"
const val BLE_ENTRY = "scenario/ble-plane.js"
const val MIC_PLANE_SCENARIO = "android.mic-plane"
const val MIC_PLANE_ENTRY = "scenario/mic-plane.js"
const val WHALE_CLIENT_ID = "dsh-web-client-compact"
/** The shared watchdog budget (the calendar-live real-turn drive overrides it). */
const val WATCHDOG_SECONDS = 180L

// ---- the factories ----------------------------------------------------------

/** Creates and starts the session; [onFinished] gets the verdict text. */
fun BindingHost.Companion.start(
    activity: Activity,
    webView: WebView?,
    onFinished: (String) -> Unit,
): BindingHost {
    val host = BindingHost(activity)
    host.pump.attach(webView)
    BindingHost.instance = host
    host.start(onFinished)
    return host
}

/** The M2 real-LLM drive (scenario `llm.live-stream`): same carrier + WebView
 * + gateway flow, but the JS entry streams one real chat completion
 * through the gateway httpFetch. Credentials ride fs scope "app"
 * (files/profiles/default/llm-live-stream/config.json), staged by the E2E
 * runner before launch. */
fun BindingHost.Companion.startLlm(activity: Activity, webView: WebView?, onFinished: (String) -> Unit): BindingHost =
    drive("llm-live-stream", LLM_SCENARIO, LLM_ENTRY, activity, webView, onFinished)

/** The v1.5.0 device-plane drive (scenario `android.device-plane`):
 * the six SDK primitives + the media picker, driven marker-by-marker
 * from the runner. */
fun BindingHost.Companion.startDevicePlane(activity: Activity, webView: WebView?, onFinished: (String) -> Unit): BindingHost =
    drive("device-plane", DEVICE_PLANE_SCENARIO, DEVICE_PLANE_ENTRY, activity, webView, onFinished)

/** The capability plane's BLE drive (scenario `android.ble-plane`):
 * the real radio by default (an emulator answers `unavailable` honestly
 * — the CI skip leg), the deterministic mock on the mock extra. */
fun BindingHost.Companion.startBle(activity: Activity, webView: WebView?, onFinished: (String) -> Unit, mockRadio: Boolean): BindingHost =
    drive("ble-plane", BLE_SCENARIO, BLE_ENTRY, activity, webView, onFinished, mockRadio)

/** One scenario drive factory: the binding machinery with the leg's scenario
 * id, entry and capture label. The compact/parity/suite legs keep their own factories. */
private fun drive(
    captureLabel: String,
    scenarioId: String,
    entryPath: String,
    activity: Activity,
    webView: WebView?,
    onFinished: (String) -> Unit,
    mockRadio: Boolean = false,
): BindingHost {
    val host = BindingHost(
        activity,
        scenarioId = scenarioId,
        entryPath = entryPath,
        captureLabel = captureLabel,
        mockRadio = mockRadio,
    )
    host.pump.attach(webView)
    BindingHost.instance = host
    host.cardSurface = CardSurface.attach(activity) // the card face
    host.start(onFinished)
    return host
}

/** The mic drive (`android.mic-plane`): micStart/micStop + the mic.frame channel; the OS prompt pre-granted in automation. */
fun BindingHost.Companion.startMicPlane(activity: Activity, webView: WebView?, onFinished: (String) -> Unit): BindingHost =
    drive("mic-plane", MIC_PLANE_SCENARIO, MIC_PLANE_ENTRY, activity, webView, onFinished)

/** The card-player drive (`card.player`): the card face's proof. */
fun BindingHost.Companion.startCardPlayer(activity: Activity, webView: WebView?, onFinished: (String) -> Unit): BindingHost =
    drive("card-player", CARD_PLAYER_SCENARIO, CARD_PLAYER_ENTRY, activity, webView, onFinished)

/**
 * The create-card drive (`create.card`, the gaps3/android-01 spine
 * seat): the scenario boots the FULL upstream spine (boot.js mounts
 * dsh-create, capturing the real cordis context), then plugin_create's
 * execute writes the package, the scripted-approval seam answers the
 * native dialog, the registry row lands, and the authored plugin
 * LIVE-mounts into that spine — its own apply() posts the card.* bus
 * lines this surface renders. */
fun BindingHost.Companion.startCreateCard(activity: Activity, webView: WebView?, onFinished: (String) -> Unit): BindingHost =
    drive("create-card", CREATE_CARD_SCENARIO, CREATE_CARD_ENTRY, activity, webView, onFinished)

/**
 * The calendar-live drive (`create.calendar.live`, the
 * gaps3/android-04 port of the iOS `-dsh-mode calendar-live` seat):
 * ONE REAL-backend turn driven on the agent (the staged credential
 * at fs-app llm/config.json is the model route — the runner stages
 * it and skips LOUD when there is none), then the authored calendar
 * plugin LIVE-mounts through the approval → registry → import →
 * ctx.plugin chain and its own apply() drives the card face. The
 * watchdog is the turn-scale budget (a reasoning model's first byte
 * takes minutes over the emulator network — the 180 s default would
 * kill a legitimate turn mid-flight); the runtime.config delivery
 * after begin is the scenario's GO trigger. */
fun BindingHost.Companion.startCalendarLive(activity: Activity, webView: WebView?, onFinished: (String) -> Unit): BindingHost = spawn(
    activity, webView, onFinished,
    scenarioId = CALENDAR_LIVE_SCENARIO,
    entryPath = CALENDAR_LIVE_ENTRY,
    captureLabel = "calendar-live",
    watchdogSeconds = CALENDAR_LIVE_WATCHDOG_SECONDS,
).also { it.calendarLive = true }

/** The camera drive (`android.camera-plane`, v1.10.0): the capture burst
 * against the emulator's virtual camera, the phased rows' honest `unavailable`. */
fun BindingHost.Companion.startCameraPlane(activity: Activity, webView: WebView?, onFinished: (String) -> Unit): BindingHost =
    drive("camera-plane", CAMERA_PLANE_SCENARIO, CAMERA_PLANE_ENTRY, activity, webView, onFinished)

/** The upstream-suite drive (scenario `upstream.suite`): ONE transpiled
 * upstream spec executed by the quickjs-shaped harness in our runtime;
 * the spec name rides the runtime.config bus delivery. */
fun BindingHost.Companion.startSuite(activity: Activity, webView: WebView?, onFinished: (String) -> Unit, spec: String): BindingHost = spawn(
    activity, webView, onFinished,
    scenarioId = SUITE_SCENARIO,
    entryPath = SUITE_ENTRY,
    captureLabel = "upstream-suite",
).also { it.suiteSpec = spec }

/** The upstream-parity drive (scenario `upstream.parity`): the port leg against the committed golden. */
fun BindingHost.Companion.startParity(activity: Activity, webView: WebView?, onFinished: (String) -> Unit): BindingHost = spawn(
    activity, webView, onFinished,
    scenarioId = PARITY_SCENARIO,
    entryPath = PARITY_ENTRY,
    captureLabel = "upstream-parity",
    parityMode = true,
)

/** The compact creation-client drive (scenario `android.compactweb.mount`). */
fun BindingHost.Companion.startWhale(activity: Activity, webView: WebView?, onFinished: (String) -> Unit): BindingHost = spawn(
    activity, webView, onFinished,
    scenarioId = COMPACT_SCENARIO,
    entryPath = COMPACT_ENTRY,
    captureLabel = "android-compact-mount",
    clientId = WHALE_CLIENT_ID,
    webRootDir = "webclient-compact/web",
    compactLeg = true,
)

/** The shared factory tail of the scenario-swap drives (the
 * device/camera/BLE siblings): construct, attach, park, start. */
private fun spawn(
    activity: Activity,
    webView: WebView?,
    onFinished: (String) -> Unit,
    scenarioId: String,
    entryPath: String,
    captureLabel: String,
    mockRadio: Boolean = false,
    clientId: String = "dsh-web-client",
    webRootDir: String = "webclient/web",
    compactLeg: Boolean = false,
    parityMode: Boolean = false,
    watchdogSeconds: Long = WATCHDOG_SECONDS,
): BindingHost {
    val host = BindingHost(
        activity,
        scenarioId = scenarioId,
        entryPath = entryPath,
        captureLabel = captureLabel,
        clientId = clientId,
        webRootDir = webRootDir,
        compactLeg = compactLeg,
        mockRadio = mockRadio,
    )
    if (parityMode) host.parityMode = true
    host.watchdogSeconds = watchdogSeconds
    host.pump.attach(webView)
    BindingHost.instance = host
    host.cardSurface = CardSurface.attach(activity)
    host.start(onFinished)
    return host
}
