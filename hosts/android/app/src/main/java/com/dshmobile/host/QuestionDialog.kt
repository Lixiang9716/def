package com.dshmobile.host

import android.app.Activity
import android.app.AlertDialog
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import org.json.JSONArray
import org.json.JSONObject

/**
 * QuestionDialog — the in-band user-questions answer face on Android (the
 * Kotlin sibling of hosts/ios SessionQuestions.swift): one native dialog per
 * ask, the answer delivers back as a `question.answer` bus message —
 * question-bridge.js's composer intercept resolves the parked
 * ask_user_question with it and the turn resumes. Multi-question asks chain
 * one dialog after another. Main-thread confined (the caller hops).
 *
 * face.question@1 (R3 batch 2, the iOS SessionQuestions posture): options
 * are the canonical `{id, label}` objects (a bare string stays accepted —
 * both fields read from it) and answers identify options by **id**, never by
 * echoed display label (a relabeled option keeps its round-trip). The
 * longest-string label heuristic and the ≤3-button ceiling are retired —
 * every option renders as its own button row, so the renderer is no longer
 * lossy past three options. The 取消 button DELIVERS `question.answer` with
 * `outcome:"cancelled"` — the park-forever defect (取消 dismissed without
 * answering, so no answer ever settled the ask and the turn waited forever)
 * dies here. An answered ask on a versioned request answers with
 * `outcome:"answered"`; legacy frames (no schemaVersion) stay byte-shaped
 * exactly as before.
 */

/** One structured answer row (selected option IDs, or the typed custom text). */
private fun answerOf(qid: String, selected: JSONArray?, custom: String?): JSONObject {
    val row = JSONObject().put("id", qid)
    if (selected != null) row.put("selected", selected)
    if (custom != null) row.put("custom", custom)
    return row
}

/** face.question@1 option normalization — canonical `(id, label)` pairs (the
 * dispatch layer normalizes producer-side; this read tolerates the legacy
 * shapes a raw producer still posts): a bare string is accepted as both; an
 * object reads its `id`/`label` strings (either defaulting to the other);
 * alien shapes drop with one structured warn (the ask still renders). */
private fun parseOptions(raw: JSONArray?): List<Pair<String, String>> {
    if (raw == null) return emptyList()
    val options = mutableListOf<Pair<String, String>>()
    for (i in 0 until raw.length()) {
        when (val entry = raw.opt(i)) {
            is String -> options.add(entry to entry)
            is JSONObject -> {
                val id = entry.opt("id")
                val label = entry.opt("label")
                val idString = id as? String
                val labelString = label as? String
                when {
                    idString != null && labelString != null -> options.add(idString to labelString)
                    labelString != null -> options.add(labelString to labelString)
                    idString != null -> options.add(idString to idString)
                    else -> GatewayCore.uiMarker("question-degrade", "option-dropped")
                }
            }
            else -> GatewayCore.uiMarker("question-degrade", "option-dropped")
        }
    }
    return options
}

/** The scripted-question test seam (`--es dsh.script.question cancel` — the
 * approval seam's shape, UiPrimitives.scriptedApprovalFlag): the dialog
 * still presents — the native path is exercised — then settles exactly the
 * way the tapped 取消 would, so drives retire their UI automation on the
 * one dialog the API plane cannot answer by design. Absent the extra the
 * human answers; the product default is unchanged. */
private fun scriptCancelIfAsked(activity: Activity, cancel: () -> Unit) {
    val script = activity.intent?.getStringExtra("dsh.script.question") ?: return
    if (script != "cancel") return
    activity.runOnUiThread {
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            GatewayCore.uiMarker("question", "script")
            android.util.Log.i("dsh.question", "script answered cancel")
            cancel()
        }, 350)
    }
}

/** The free-text ask (a question with no options): one dialog with an input;
 * the commit callback receives the typed answer row; 取消 settles the ask
 * cancelled (the park-forever defect dies here too). */
private fun askFreeText(
    activity: Activity,
    question: JSONObject,
    questionId: String,
    onAnswer: (JSONObject) -> Unit,
    onCancel: () -> Unit,
) {
    activity.runOnUiThread {
        val input = EditText(activity)
        input.hint = "自己写…"
        val box = LinearLayout(activity)
        box.orientation = LinearLayout.VERTICAL
        box.setPadding(48, 16, 48, 0)
        box.addView(input)
        val builder = AlertDialog.Builder(activity)
            .setTitle(question.optString("header", "def"))
            .setMessage(question.optString("question", ""))
            .setView(box)
            .setPositiveButton("提交") { dialog, _ ->
                dialog.dismiss()
                onAnswer(answerOf(questionId, null, input.text.toString()))
            }
            .setNegativeButton("取消") { dialog, _ ->
                dialog.dismiss()
                onCancel()
            }
        builder.show()
        scriptCancelIfAsked(activity, onCancel)
    }
}

/** The options ask: one dialog with a button row PER OPTION (any count —
 * the 2026-10-29 emulator finding was that the themed AlertDialog's ITEM
 * LIST collapses to zero height; buttons are the one face that cannot), so
 * the renderer is lossless past three options. The answer identifies the
 * option by id (face.question@1) — a relabel between ask and answer keeps
 * the round-trip. 取消 settles the ask cancelled. */
private fun askOptions(
    activity: Activity,
    question: JSONObject,
    questionId: String,
    options: List<Pair<String, String>>,
    onAnswer: (JSONObject) -> Unit,
    onCancel: () -> Unit,
) {
    activity.runOnUiThread {
        android.util.Log.i("dsh.question", "askOptions parsed: ${options.size} options (id-label)")
        val d = activity.resources.displayMetrics.density
        val pad = fun(v: Int) = (v * d).toInt()
        val list = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad(24), pad(8), pad(24), pad(8))
        }
        val builder = AlertDialog.Builder(activity)
            .setTitle(question.optString("header", "def"))
            .setMessage(question.optString("question", ""))
            .setNegativeButton("取消") { dialog, _ ->
                dialog.dismiss()
                onCancel()
            }
        val dialog = builder.create()
        for ((id, label) in options) {
            val button = android.widget.Button(activity).apply {
                text = label
                setOnClickListener {
                    dialog.dismiss()
                    onAnswer(answerOf(questionId, JSONArray().put(id), null))
                }
            }
            list.addView(button, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = pad(4) })
        }
        val scroll = ScrollView(activity).apply { addView(list) }
        dialog.setView(scroll)
        dialog.show()
        scriptCancelIfAsked(activity, onCancel)
    }
}

/** The ask chain: one dialog per question, then the settle. The v1
 * `outcome` rides only versioned requests (legacy frames stay exact); the
 * settle is exactly-once per ask (the scripted cancel and a human cancel
 * must not double-deliver). */
fun showQuestionDialog(activity: Activity, msg: JSONObject, deliverRuntime: (JSONObject) -> Unit) {
    val questions = msg.optJSONArray("questions") ?: return
    val id = msg.optString("id")
    val versioned = msg.optInt("schemaVersion", 0) >= 1
    val answers = JSONArray()
    var settled = false
    val settle = { outcome: String ->
        if (!settled) {
            settled = true
            val payload = JSONObject()
                .put("type", "question.answer")
                .put("id", id)
                .put("answers", answers)
            if (versioned) payload.put("outcome", outcome)
            deliverRuntime(payload)
        }
    }
    val cancelled = { settle("cancelled") }
    fun askAt(index: Int) {
        if (index >= questions.length()) {
            settle("answered")
            return
        }
        val question = questions.getJSONObject(index)
        val questionId = question.optString("id", "q$index")
        val options = parseOptions(question.optJSONArray("options"))
        val onAnswer = { row: JSONObject ->
            answers.put(row)
            askAt(index + 1)
        }
        if (options.isEmpty()) askFreeText(activity, question, questionId, onAnswer, cancelled)
        else askOptions(activity, question, questionId, options, onAnswer, cancelled)
    }
    askAt(0)
}
