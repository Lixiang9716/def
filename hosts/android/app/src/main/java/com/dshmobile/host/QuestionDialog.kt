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
        val options = question.optJSONArray("options") ?: return@runOnUiThread
        val labels = (0 until options.length()).map { options.getJSONObject(it).optString("label") }
        val builder = AlertDialog.Builder(activity)
            .setTitle(question.optString("header", "def"))
            .setMessage(question.optString("question", ""))
            .setSingleChoiceItems(labels.toTypedArray(), -1) { dialog, which ->
                dialog.dismiss()
                onAnswer(answerOf(questionId, JSONArray().put(labels[which]), null))
            }
            .setNegativeButton("取消") { dialog, _ -> dialog.dismiss() }
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
