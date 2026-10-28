package com.dshmobile.host

import android.app.Activity
import android.app.AlertDialog
import android.widget.EditText
import android.widget.LinearLayout
import org.json.JSONArray
import org.json.JSONObject

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
        activity.runOnUiThread {
            val builder = AlertDialog.Builder(activity)
                .setTitle(question.optString("header", "def"))
                .setMessage(question.optString("question", ""))
            if (options != null && options.length() > 0) {
                val labels = (0 until options.length()).map { options.getJSONObject(it).optString("label") }
                builder.setSingleChoiceItems(labels.toTypedArray(), -1) { dialog, which ->
                    dialog.dismiss()
                    answers.put(JSONObject().put("id", questionId)
                        .put("selected", JSONArray().put(labels[which])))
                    askAt(index + 1)
                }
                builder.setNegativeButton("取消") { dialog, _ -> dialog.dismiss() }
            } else {
                val input = EditText(activity)
                input.hint = "自己写…"
                val box = LinearLayout(activity)
                box.orientation = LinearLayout.VERTICAL
                box.setPadding(48, 16, 48, 0)
                box.addView(input)
                builder.setView(box)
                builder.setPositiveButton("提交") { dialog, _ ->
                    dialog.dismiss()
                    answers.put(JSONObject().put("id", questionId)
                        .put("selected", JSONArray())
                        .put("custom", input.text.toString()))
                    askAt(index + 1)
                }
                builder.setNegativeButton("取消") { dialog, _ -> dialog.dismiss() }
            }
            builder.show()
        }
    }
    askAt(0)
}
