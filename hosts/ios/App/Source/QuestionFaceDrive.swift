import Foundation

/// The question-face drive (`-dsh-mode question-face`): the serving seat
/// with the face.question@1 pilot leg selected — a REAL
/// `ctx.userQuestions.ask()` parks through the question bridge, the NATIVE
/// alert is the answer face, and the scripted cancel (`-dsh-script-question
/// cancel`) settles the parked turn with `outcome:"cancelled"` (the
/// park-forever defect the R3 proposal kills). The card surface stays
/// unwired here — this leg's story is the ask alone (card.player owns the
/// card face's leg on the same serving seat shape).
enum QuestionFaceDrive {
    /// The mode-table entry: banner + the canonical stdout line, then the
    /// drive (the CardPlayerDrive shape minus the card surface).
    static func launch(_ appDelegate: AppDelegate) {
        appDelegate.announce(
            "DSH question face — question.face, a native ask that settles on cancel…",
            line: "rt: app launched in question-face mode", web: true)
        run(appDelegate)
    }

    static func run(_ appDelegate: AppDelegate) {
        let serve = SessionServe(
            credential: SessionServe.loadCredential(),
            interactive: false)
        appDelegate.serve = serve
        serve.scenarioEntry = (
            accessor: dsh_runtime_res_scenario_question_face_js,
            path: "scenario/question-face.js"
        )
        serve.onOrigin = { [weak appDelegate] origin in
            appDelegate?.webView?.load(URLRequest(url: origin))
        }
        serve.onRuntimeFailure = { message in
            NSLog("%@", "dsh.session.serve: runtime failed: \(message)")
        }
        do {
            try serve.start()
        } catch {
            NSLog("%@", "dsh.session.serve: bootstrap failed: \(error)")
            print("rt: question-face bootstrap failed: \(error)")
            fflush(stdout)
        }
    }
}
