package com.dshmobile.host

import android.app.Activity
import android.app.AlertDialog
import android.widget.EditText
import android.widget.LinearLayout
import org.json.JSONArray
import org.json.JSONObject

/** One structured answer row (selected labels, or the typed custom text). */
private fun answerOf(qid: String, selected: JSONArray?, custom: String?): JSONObject {
    val row = JSONObject().put("id", qid)
    if (selected != null) row.put("selected", selected)
    if (custom != null) row.put("custom", custom)
    return row
}

/** The free-text ask (a question with no options): one dialog with an
 * input; the commit callback receives the typed answer row. */
private fun askFreeText(
    activity: Activity,
    question: JSONObject,
    questionId: String,
    onAnswer: (JSONObject) -> Unit,
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
            .setNegativeButton("取消") { dialog, _ -> dialog.dismiss() }
        builder.show()
    }
}

/** The options ask: one dialog with single-choice rows. */
private fun askOptions(
    activity: Activity,
    question: JSONObject,
    questionId: String,
    onAnswer: (JSONObject) -> Unit,
) {
    activity.runOnUiThread {
        val options = question.optJSONArray("options")
        android.util.Log.i("dsh.question", "askOptions parsed: ${options?.length() ?: -1} options, raw=${options?.toString()?.take(200)}")
        if (options == null) return@runOnUiThread
        val labels = (0 until options.length()).map { i ->
            // The model's option shapes seen live: bare strings, objects
            // {label|text|...} — the key VARIES by model whim, so take the
            // object's LONGEST string value (the label is always its
            // longest field; the description runs shorter) and fall back
            // to the JSON itself when the object carries no strings.
            val entry = options.opt(i)
            when (entry) {
                is String -> entry
                is JSONObject -> {
                    var best = ""
                    for (k in entry.keys()) {
                        val v = entry.optString(k)
                        if (v.length > best.length) best = v
                    }
                    if (best.isEmpty()) entry.toString() else best
                }
                else -> entry.toString()
            }
        }
        // The options render as DIALOG BUTTONS (positive/neutral/negative):
        // the themed AlertDialog's item list collapsed to zero height on the
        // emulator (measured 2026-10-29 — setItems and setSingleChoiceItems
        // both), and buttons are the one face that cannot collapse. Three
        // options max; more fall back to the free-text input.
        android.util.Log.i("dsh.question", "labels armed: ${labels.size} → ${labels.joinToString(" | ").take(200)}")
        val builder = AlertDialog.Builder(activity)
            .setTitle(question.optString("header", "def"))
            .setMessage(question.optString("question", ""))
        if (labels.size in 1..3) {
            builder.setPositiveButton(labels[0]) { dialog, _ ->
                dialog.dismiss()
                onAnswer(answerOf(questionId, JSONArray().put(labels[0]), null))
            }
            if (labels.size >= 2) builder.setNeutralButton(labels[1]) { dialog, _ ->
                dialog.dismiss()
                onAnswer(answerOf(questionId, JSONArray().put(labels[1]), null))
            }
            if (labels.size >= 3) builder.setNegativeButton(labels[2]) { dialog, _ ->
                dialog.dismiss()
                onAnswer(answerOf(questionId, JSONArray().put(labels[2]), null))
            }
        } else {
            // More than three options (or none): the free-text input covers
            // the answer (the model reads the typed reply).
            val input = EditText(activity)
            input.hint = "自己写…"
            val box = LinearLayout(activity)
            box.orientation = LinearLayout.VERTICAL
            box.setPadding(48, 16, 48, 0)
            box.addView(input)
            builder.setView(box)
                .setPositiveButton("提交") { dialog, _ ->
                    dialog.dismiss()
                    onAnswer(answerOf(questionId, null, input.text.toString()))
                }
                .setNegativeButton("取消") { dialog, _ -> dialog.dismiss() }
        }
        builder.show()
    }
}

/** The in-band user-questions answer face (split from SessionServe at the
 * code-size gate): one native dialog per ask, options as single-choice rows
 * (the model's recommended label first), free-text when the question
 * carries no options. The answer delivers back as a `question.answer` bus
 * message — question-bridge.js's composer intercept resolves the parked
 * ask_user_question with it and the turn resumes. Multi-question asks
 * chain one dialog after another. Main-thread confined (the caller hops). */
fun showQuestionDialog(activity: Activity, msg: JSONObject, deliverRuntime: (JSONObject) -> Unit) {
    val questions = msg.optJSONArray("questions") ?: return
    val id = msg.optString("id")
    val answers = JSONArray()
    fun deliver() {
        deliverRuntime(JSONObject().put("type", "question.answer").put("id", id).put("answers", answers))
    }
    fun askAt(index: Int) {
        if (index >= questions.length()) {
            deliver()
            return
        }
        val question = questions.getJSONObject(index)
        val questionId = question.optString("id", "q$index")
        val options = question.optJSONArray("options")
        val hasOptions = options != null && options.length() > 0
        val onAnswer = { row: JSONObject ->
            answers.put(row)
            askAt(index + 1)
        }
        if (hasOptions) askOptions(activity, question, questionId, onAnswer)
        else askFreeText(activity, question, questionId, onAnswer)
    }
    askAt(0)
}
