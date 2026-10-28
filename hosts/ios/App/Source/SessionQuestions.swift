import UIKit
import Foundation

/// The in-band user-questions answer face (split from SessionServe at the
/// code-size gate): one native alert per ask, options as alert actions (the
/// model's recommended label first), free-text when the question carries no
/// options. The answer delivers back as a `question.answer` bus message —
/// question-bridge.js's composer intercept resolves the parked
/// ask_user_question with it and the turn resumes. Multi-question asks
/// chain one alert after another.
func showQuestionDialog(
    _ msg: [String: Any],
    deliver: @escaping ([String: Any]) -> Void,
) {
    guard let window = UIApplication.shared.connectedScenes
        .compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first,
        let root = window.rootViewController else { return }
    let questions = msg["questions"] as? [[String: Any]] ?? []
    let askId = msg["id"] as? String ?? ""
    var answers: [[String: Any]] = []
    func askAt(_ index: Int) {
        guard index < questions.count else {
            deliver(["type": "question.answer", "id": askId, "answers": answers])
            return
        }
        let question = questions[index]
        let questionId = question["id"] as? String ?? "q\(index)"
        let alert = UIAlertController(
            title: (question["header"] as? String) ?? "def",
            message: (question["question"] as? String) ?? "",
            preferredStyle: .alert)
        let options = question["options"] as? [[String: Any]] ?? []
        if options.isEmpty {
            alert.addTextField { field in
                field.placeholder = "自己写…"
                field.autocorrectionType = .no
            }
            alert.addAction(UIAlertAction(title: "提交", style: .default) { _ in
                var answer: [String: Any] = ["id": questionId, "selected": [String]()]
                if let text = alert.textFields?.first?.text, !text.isEmpty {
                    answer["custom"] = text
                }
                answers.append(answer)
                askAt(index + 1)
            })
        } else {
            for option in options {
                let label = (option["label"] as? String) ?? ""
                alert.addAction(UIAlertAction(title: label, style: .default) { _ in
                    answers.append(["id": questionId, "selected": [label]])
                    askAt(index + 1)
                })
            }
        }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        root.present(alert, animated: true)
    }
    askAt(0)
}
