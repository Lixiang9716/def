import UIKit
import Foundation

/// The in-band user-questions answer face (split from SessionServe at the
/// code-size gate): one native alert per ask, options as alert actions (the
/// model's recommended label first), free-text when the question carries no
/// options. The answer delivers back as a `question.answer` bus message —
/// question-bridge.js's composer intercept resolves the parked
/// ask_user_question with it and the turn resumes. Multi-question asks
/// chain one alert after another.
///
/// face.question@1 (R3 pilot): options are the canonical `{id, label}`
/// objects (a bare string stays accepted — both fields read from it), and
/// answers identify options by **id**, never by echoed display label (a
/// relabeled option keeps its round-trip). The 取消 button DELIVERS
/// `question.answer` with `outcome:"cancelled"` — the park-forever defect
/// (this button previously had no handler, so no answer ever settled the
/// ask and the turn waited forever) dies here. An answered ask on a
/// versioned request answers with `outcome:"answered"`; legacy frames
/// (no schemaVersion) stay byte-shaped exactly as before.
/// face.question@1 options: canonical `{id, label}`; a bare string stays
/// accepted as both (the dispatch layer normalizes producer-side — this
/// read tolerates the legacy shapes a raw producer still posts).
private func parseOptions(_ raw: Any) -> [(id: String, label: String)] {
    if let objects = raw as? [[String: Any]] {
        return objects.compactMap { option in
            let label = option["label"] as? String
            let id = option["id"] as? String
            if let label { return (id: id ?? label, label: label) }
            if let id { return (id: id, label: id) }
            return nil
        }
    }
    return (raw as? [String] ?? []).map { ($0, $0) }
}

func showQuestionDialog(
    _ msg: [String: Any],
    deliver: @escaping ([String: Any]) -> Void,
) {
    guard let window = UIApplication.shared.connectedScenes
        .compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first,
        let root = window.rootViewController else { return }
    let questions = msg["questions"] as? [[String: Any]] ?? []
    let askId = msg["id"] as? String ?? ""
    let versioned = (msg["schemaVersion"] as? Int ?? 0) >= 1
    var answers: [[String: Any]] = []
    func askAt(_ index: Int) {
        guard index < questions.count else {
            settleAsk(askId, versioned: versioned, answers: answers,
                deliver: deliver, outcome: "answered")
            return
        }
        let question = questions[index]
        let questionId = question["id"] as? String ?? "q\(index)"
        let alert = questionAlert(question)
        let options = parseOptions(question["options"] ?? [])
        if options.isEmpty {
            alert.addTextField { field in
                field.placeholder = "自己写…"
                field.autocorrectionType = .no
            }
            alert.addAction(UIAlertAction(title: "提交", style: .default) { _ in
                answers.append(freeTextAnswer(alert, questionId: questionId))
                askAt(index + 1)
            })
        } else {
            addOptionActions(alert, options: options, questionId: questionId) {
                answers.append($0)
                askAt(index + 1)
            }
        }
        // The cancel that finally settles: outcome "cancelled" resolves the
        // bridge's parked ask — the turn resumes with the answers gathered
        // so far instead of waiting forever.
        let cancel = {
            settleAsk(askId, versioned: versioned, answers: answers,
                deliver: deliver, outcome: "cancelled")
        }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in cancel() })
        root.present(alert, animated: true)
        scriptAnswerIfAsked(alert, cancel: cancel)
    }
    askAt(0)
}

/// The one alert per question (header defaults "def", body the question).
private func questionAlert(_ question: [String: Any]) -> UIAlertController {
    UIAlertController(
        title: (question["header"] as? String) ?? "def",
        message: (question["question"] as? String) ?? "",
        preferredStyle: .alert)
}

/// One option button per face.question@1 option: the answer identifies the
/// option by id (v1) — a relabel between ask and answer keeps the round-trip.
private func addOptionActions(
    _ alert: UIAlertController, options: [(id: String, label: String)],
    questionId: String, picked: @escaping ([String: Any]) -> Void
) {
    for option in options {
        alert.addAction(UIAlertAction(title: option.label, style: .default) { _ in
            picked(["id": questionId, "selected": [option.id]])
        })
    }
}

/// One settle per ask, shaped by the face version the request spoke (the
/// v1 `outcome` rides only versioned requests; legacy frames stay exact).
private func settleAsk(
    _ askId: String, versioned: Bool, answers: [[String: Any]],
    deliver: @escaping ([String: Any]) -> Void, outcome: String
) {
    var answer: [String: Any] = [
        "type": "question.answer", "id": askId, "answers": answers,
    ]
    if versioned { answer["outcome"] = outcome }
    deliver(answer)
}

/// The free-text answer of an options-less question (empty selection plus
/// the typed text when any).
private func freeTextAnswer(
    _ alert: UIAlertController, questionId: String
) -> [String: Any] {
    var answer: [String: Any] = ["id": questionId, "selected": [String]()]
    if let text = alert.textFields?.first?.text, !text.isEmpty {
        answer["custom"] = text
    }
    return answer
}

/// The scripted-question test seam (`-dsh-script-question cancel` — the
/// approval seam's shape, UIPrimitives.scriptAnswerIfAsked): the alert
/// still presents — the native path is exercised — then settles exactly
/// the way the tapped 取消 would, so drives retire their WDA taps on the
/// one dialog the API plane cannot answer by design. Absent the flag the
/// human answers; the product default is unchanged.
private func scriptAnswerIfAsked(
    _ alert: UIAlertController, cancel: @escaping () -> Void
) {
    let args = ProcessInfo.processInfo.arguments
    guard let flag = args.firstIndex(of: "-dsh-script-question"),
          flag + 1 < args.count, args[flag + 1] == "cancel" else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
        GatewayCore.uiMarker("question", "script")
        NSLog("dsh.question: script answered cancel")
        alert.dismiss(animated: false)
        cancel()
    }
}
