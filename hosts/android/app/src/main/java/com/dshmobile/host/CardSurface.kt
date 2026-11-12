package com.dshmobile.host

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject

/**
 * CardSurface — the NATIVE half of the plugin card contract on Android
 * (Kotlin sibling of hosts/ios CardPlayerSurface.swift, #452's PiP shape):
 * a plugin speaks bus lines (`card.present` / `card.state` / `card.dismiss`
 * / `card.complete`) and this surface renders them as a floating card over
 * the app's own chrome — the plugin manifests in the app, not as a web page.
 *
 * PiP posture (#452's UX fix): the card anchors TOP-END under the status
 * bar — never over the bottom-docked composer — and is DRAGGABLE anywhere
 * within the overlay and LOCALLY closable (the ✕). Dismissal authority
 * stays the plugin's per the contract: a locally closed card ignores later
 * card.state/complete records and the next card.present re-shows it.
 *
 * face.card@1 (R3 batch 2, the iOS CardPlayerSurface posture): this surface
 * is now a GENERIC renderer of the declarative payload — `schemaVersion` is
 * read (a future version renders legacy + one structured warn), the
 * declarative `card.actions: [{id, label}]` render as real buttons, a
 * missing id is REFUSED with a warn instead of silently dropped, an unknown
 * kind degrades to `info` with a warn, and the user's acts (close ✕, drag
 * end, button tap) return to the runtime as `card.action` events over
 * [postAction] — the SAME runtime bridge the question answer rides. The
 * close is terminal-once per presented card (`close` beats a pending
 * button) and OBSERVABLE, never authoritative.
 *
 * Timer cards tick locally between authoritative card.state patches (a
 * 250 ms handler re-renders the countdown from the anchor). Main-thread
 * only for [handle]; [snapshot] is thread-safe (it reads a volatile face
 * record) so the /api/state seam can call it from a connection thread.
 */
class CardSurface private constructor(private val activity: Activity) {

    private val main = Handler(Looper.getMainLooper())
    /** The overlay the card floats in (the activity's content, above the WebView). */
    private val overlay = FrameLayout(activity)
    /** The presented card's projected face — volatile: read cross-thread. */
    @Volatile private var face = JSONObject().put(
        "card", JSONObject().put("attached", true).put("visible", false),
    )
    /** face.card@1 the payload declared (0 = legacy — today's exact shape). */
    private var cardSchemaVersion = 0
    /** One terminal action per presented card (`close` beats a pending
     * button — the v1 order guarantee); re-armed by every present. */
    private var actionTerminal = false

    /** The host→runtime action delivery — the SAME runtime bridge the
     * question answer rides. The drive wires it; null (a seat without a
     * runtime bridge) makes actions local-only. */
    var postAction: ((JSONObject) -> Unit)? = null

    companion object {
        /** Attaches the overlay above everything in the activity's content. */
        fun attach(activity: Activity): CardSurface {
            val surface = CardSurface(activity)
            val content = activity.findViewById<ViewGroup>(android.R.id.content)
            content.addView(
                surface.overlay,
                ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                ),
            )
            return surface
        }
    }

    // ---- the four contract events (main thread) -----------------------------

    /** One bus card.* record, already hopped onto the main thread. */
    fun handle(msg: JSONObject) {
        when (msg.optString("type")) {
            "card.present" -> present(msg)
            "card.state" -> state(msg)
            "card.complete" -> complete(msg)
            "card.dismiss" -> dismiss()
        }
    }

    /** The projected face for the GET /api/state seam (any thread). */
    fun snapshot(): JSONObject = JSONObject(face.toString())

    // ---- the contract events, rendered ---------------------------------------

    private var cardBox: FrameLayout? = null
    private lateinit var titleView: TextView
    private lateinit var timeView: TextView
    private lateinit var subtitleView: TextView
    private lateinit var progress: ProgressBar
    /** The rendered declarative actions: (actionId, button) pairs. */
    private val actionButtons = mutableListOf<Pair<String, TextView>>()
    private var card = JSONObject()
    private var remainingMs = 0.0
    private var anchorAt = 0L
    private var ticking = false
    /** The drag's start point: raw touch + the translation at ACTION_DOWN. */
    private var dragStart: FloatArray? = null

    private fun present(msg: JSONObject) {
        // face.card@1 degradation ladder (never crash, never silent): a
        // future schemaVersion renders legacy (unknown fields ignored) with
        // one structured warn; a missing id is refused AND warned — the
        // honesty fix for the silent drop every host shipped before.
        cardSchemaVersion = msg.optInt("schemaVersion", 0)
        if (cardSchemaVersion > 1) {
            GatewayCore.uiMarker("card-degrade", "schema-$cardSchemaVersion")
        }
        val record = msg.optJSONObject("card") ?: run {
            GatewayCore.uiMarker("card-degrade", "missing-card")
            return
        }
        val id = record.optString("id")
        if (id.isEmpty()) {
            GatewayCore.uiMarker("card-degrade", "missing-id")
            return
        }
        var kind = record.optString("kind", "info")
        if (kind != "info" && kind != "timer") {
            GatewayCore.uiMarker("card-degrade", "kind-$kind")
            kind = "info"
        }
        val actions = parseCardActions(record)
        record.put("kind", kind) // the degraded kind is what renders (snapshot truth)
        card = record
        remainingMs = record.optDouble("durationMs", 0.0)
        anchorAt = System.currentTimeMillis()
        actionTerminal = false
        showCard(
            title = record.optString("title", id),
            subtitle = record.optString("subtitle", ""),
            kind = kind,
            actions = actions,
        )
        projectFace()
        GatewayCore.uiMarker("card-present", "wait")
    }

    /** One declarative face.card@1 action: `{id, label}` renders as a button. */
    private data class CardActionSpec(val id: String, val label: String)

    /** The v1-add declarative actions: `[{id, label}]` render as real
     * buttons; malformed entries drop with one warn (the card renders). */
    private fun parseCardActions(record: JSONObject): List<CardActionSpec> {
        val actions = mutableListOf<CardActionSpec>()
        val rawActions = record.optJSONArray("actions")
        if (rawActions != null) {
            for (i in 0 until rawActions.length()) {
                val entry = rawActions.optJSONObject(i) ?: continue
                // Explicit string reads (optString would coerce a number):
                // id non-empty REQUIRED; label any string (the schema allows
                // the empty label — face-schemas.js's nonEmptyString(id) +
                // typeof label === 'string' pair).
                val actionId = if (entry.opt("id") is String) entry.getString("id") else ""
                val label = if (entry.opt("label") is String) entry.getString("label") else null
                if (actionId.isNotEmpty() && label != null) {
                    actions.add(CardActionSpec(actionId, label))
                }
            }
            if (actions.size != rawActions.length()) {
                GatewayCore.uiMarker("card-degrade", "actions-dropped")
            }
        } else if (record.has("actions")) {
            GatewayCore.uiMarker("card-degrade", "actions-type")
        }
        return actions
    }

    private fun state(msg: JSONObject) {
        if (cardBox == null) return
        val patch = msg.optJSONObject("state") ?: return
        val remaining = patch.optDouble("remainingMs", Double.NaN)
        if (!remaining.isNaN()) {
            remainingMs = remaining
            anchorAt = System.currentTimeMillis()
        }
        val label = patch.optString("label", "")
        if (label.isNotEmpty()) subtitleView.text = label
        render()
        projectFace()
    }

    private fun complete(msg: JSONObject) {
        if (cardBox == null) return
        remainingMs = 0.0
        subtitleView.text = msg.optString("message", "完成")
        render()
        GatewayCore.uiMarker("card-present", "done")
        scriptActionIfAsked()
        main.postDelayed({ dismiss() }, 2_500)
    }

    private fun dismiss() {
        stopTick()
        cardBox?.let { overlay.removeView(it) }
        cardBox = null
        actionButtons.clear()
        projectFace()
    }

    // ---- face.card@1 user actions (host → runtime) ----------------------------

    /** One `card.action` event per user act: `{id, action: close | drag-end
     * | button, actionId?, at}`. The close is terminal-once per presented
     * card; buttons are not terminal (a producer may collect several). */
    private fun postCardAction(action: String, actionId: String?) {
        if (action == "close") {
            if (actionTerminal) return
            actionTerminal = true
        }
        val bridge = postAction ?: return
        val event = JSONObject()
            .put("type", "card.action")
            .put("id", card.optString("id"))
            .put("action", action)
            .put("at", System.currentTimeMillis())
        if (actionId != null) event.put("actionId", actionId)
        bridge(event)
    }

    /** The scripted-action test seam (`--es dsh.script.card-action
     * button:<id>` — the approval seam's shape, UiPrimitives.scriptedApprovalFlag):
     * 1s after card.complete the named declarative button fires exactly the
     * way a tap would, so the E2E drive proves the action round-trip without
     * UI automation. Absent the extra the human acts; the product default is
     * unchanged. */
    private fun scriptActionIfAsked() {
        val script = activity.intent?.getStringExtra("dsh.script.card-action") ?: return
        if (cardBox == null) return
        if (!script.startsWith("button:")) return
        val actionId = script.removePrefix("button:")
        main.postDelayed({
            if (cardBox == null) return@postDelayed
            GatewayCore.uiMarker("card-action", "script")
            android.util.Log.i("dsh.card", "script action $actionId")
            val hit = actionButtons.firstOrNull { it.first == actionId } ?: return@postDelayed
            postCardAction("button", actionId)
            hit.second.isEnabled = false
        }, 1_000)
    }

    // ---- rendering ------------------------------------------------------------

    private fun showCard(title: String, subtitle: String, kind: String,
        actions: List<CardActionSpec>) {
        dismiss()
        val density = activity.resources.displayMetrics.density

        buildViews(activity, kind, subtitle)
        val close = buildClose(activity)
        val content = buildContent(activity)
        if (actions.isNotEmpty()) buildActions(activity, actions, content)

        val box = FrameLayout(activity).apply {
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#F2F1F0"))
                cornerRadius = 18f * density
            }
            elevation = 10f * density
            addView(content, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(close, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { gravity = Gravity.TOP or Gravity.END })
            setOnTouchListener(touchDrag)
        }

        overlay.addView(box, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            topMargin = (40 * density).toInt()
            marginEnd = (12 * density).toInt()
        })
        cardBox = box
        startTick()
        render()
    }

    /** Builds the card's views (title/time/progress/subtitle) per kind. */
    private fun buildViews(activity: Activity, kind: String, subtitle: String) {
        fun cardText(size: Float, bold: Boolean = false) = TextView(activity).apply {
            textSize = size
            gravity = Gravity.CENTER
            if (bold) setTypeface(typeface, Typeface.BOLD)
        }

        titleView = cardText(15f, bold = true)
        timeView = cardText(if (kind == "timer") 34f else 18f, bold = true)
        subtitleView = cardText(12f).apply {
            text = subtitle
            setTextColor(Color.parseColor("#6B6B6B"))
        }
        progress = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 10_000
            if (kind != "timer") alpha = 0f
        }
    }

    /** The ✕ close control: the close is OBSERVABLE (the card.action event
     * rides out first) but local — the plugin keeps its dismissal authority. */
    private fun buildClose(activity: Activity): TextView = TextView(activity).apply {
        text = "✕"
        textSize = 15f
        val d = activity.resources.displayMetrics.density
        setPadding((6 * d).toInt(), (2 * d).toInt(), (6 * d).toInt(), (2 * d).toInt())
        setOnClickListener {
            postCardAction("close", null)
            dismiss()
        }
    }

    /** The declarative action buttons (face.card@1 `actions`): one row of
     * real buttons; a tap posts the `card.action {action:"button"}` event. */
    private fun buildActions(activity: Activity, actions: List<CardActionSpec>,
        content: LinearLayout) {
        val d = activity.resources.displayMetrics.density
        val row = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        for (action in actions) {
            val button = TextView(activity).apply {
                text = action.label
                textSize = 13f
                setTypeface(typeface, Typeface.BOLD)
                gravity = Gravity.CENTER
                setPadding((10 * d).toInt(), (4 * d).toInt(), (10 * d).toInt(), (4 * d).toInt())
                background = GradientDrawable().apply {
                    setColor(Color.parseColor("#E8E6E3"))
                    cornerRadius = 9f * d
                }
                setOnClickListener {
                    postCardAction("button", action.id)
                    it.isEnabled = false
                }
            }
            row.addView(button, LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f,
            ).apply { marginEnd = (8 * d).toInt() })
            actionButtons.add(action.id to button)
        }
        row.layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = (8 * d).toInt() }
        content.addView(row)
    }

    /** The card's content column (title/time/progress/subtitle [+ actions]). */
    private fun buildContent(activity: Activity): LinearLayout {
        val pad = fun(v: Int) = (v * activity.resources.displayMetrics.density).toInt()
        return LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad(16), pad(14), pad(16), pad(12))
            for (sub in listOf(titleView, timeView, progress, subtitleView)) {
                addView(sub, LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT))
            }
        }
    }

    /** The touch drag: reposition the floating card within the overlay; the
     * gesture's end returns as a `card.action {action:"drag-end"}` event. */
    private val touchDrag = View.OnTouchListener { view, event ->
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                dragStart = floatArrayOf(event.rawX, event.rawY,
                    view.translationX, view.translationY)
                true
            }
            MotionEvent.ACTION_MOVE -> {
                val start = dragStart ?: return@OnTouchListener false
                view.translationX = start[2] + (event.rawX - start[0])
                view.translationY = start[3] + (event.rawY - start[1])
                true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                dragStart = null
                postCardAction("drag-end", null)
                true
            }
            else -> false
        }
    }

    private fun startTick() {
        if (ticking) return
        ticking = true
        main.post(object : Runnable {
            override fun run() {
                if (!ticking) return
                render()
                main.postDelayed(this, 250)
            }
        })
    }

    private fun stopTick() {
        ticking = false
    }

    private fun render() {
        val view = cardBox ?: return
        if (card.optString("kind") != "timer") {
            timeView.text = card.optString("label", subtitleView.text.toString())
            return
        }
        val elapsed = System.currentTimeMillis() - anchorAt
        val current = (remainingMs - elapsed).coerceAtLeast(0.0)
        val seconds = (current / 1000).toInt()
        timeView.text = String.format("%02d:%02d", seconds / 60, seconds % 60)
        val total = card.optDouble("durationMs", 0.0)
        if (total > 0) {
            progress.progress = ((1 - current / total) * 10_000).toInt().coerceIn(0, 10_000)
        }
        view.tag = seconds
    }

    /** Projects the face the /api/state seam reads (volatile, cross-thread):
     * the projection-consistency read the iOS snapshot keeps — the rendered
     * kind (degraded truth), the label/subtitle lines, and the declarative
     * action ids actually on the card. */
    private fun projectFace() {
        val cardFace = JSONObject()
            .put("attached", true)
            .put("visible", cardBox != null)
        if (cardBox != null) {
            cardFace.put("id", card.optString("id"))
            cardFace.put("title", card.optString("title", card.optString("id")))
            cardFace.put("kind", card.optString("kind", "info"))
            val label = card.optString("label")
            if (label.isNotEmpty()) cardFace.put("label", label)
            val subtitle = card.optString("subtitle")
            if (subtitle.isNotEmpty()) cardFace.put("subtitle", subtitle)
            if (actionButtons.isNotEmpty()) {
                val ids = JSONArray()
                for ((actionId, _) in actionButtons) ids.put(actionId)
                cardFace.put("actions", ids)
            }
        }
        face = JSONObject().put("card", cardFace)
    }
}
