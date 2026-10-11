import Foundation

/// Drives `session-persist.restart` (the iOS restart leg of the
/// session-persistence family): the serving seat boots the gated spine
/// through web-live/session-persist-restart.js — the shared self-staging
/// core's iOS entry — and the RUNNER owns the restart: launch 1 runs the
/// create leg (one scripted turn journals the configured session, the
/// backend flush makes it durable) and this drive settles PASS; the runner
/// then force-kills the process (`simctl terminate`) and relaunches the same
/// mode, and launch 2 resumes the stored journal (create → force kill →
/// relaunch → read back → turn 2). No WebView drive: the leg has no page —
/// the runtime half probes its own read surface in-process, so the scenario
/// completion IS the verdict. The serving path is `SessionServe` itself
/// (scenarioEntry selects the entry; the drive-seat default keeps the
/// interactive rows off — the gate row comes from the scenario's own boot
/// options, the CLI scenario's `sessionPersistence: {}` shape). Shape
/// sibling of SessionWriteRuntime and the calendar-live scenarioEntry
/// override, minus the page.
final class SessionPersistRestartRuntime {
    static let scenario = "session-persist.restart"
    static let clientID = SessionServe.clientID
    static let watchdogSeconds = 240

    /// The drive seat: no credential (the scripted loopback route the leg
    /// pins), interactive default false (the boot carries no interactive
    /// rows and no seat persistence row — the scenario mounts the gate).
    private let serve = SessionServe()
    let eventLog = CarrierEventLog(scenario: SessionPersistRestartRuntime.scenario)
    private var completion: ((JsOutcome) -> Void)?
    private var watchdog: DispatchWorkItem?
    private var finished = false

    func run(completion: @escaping (JsOutcome) -> Void) {
        self.completion = completion
        armWatchdog()
        // First record in the manifest: the configuration selected the
        // official client.
        eventLog.emit("client.selected", ["client": Self.clientID, "source": "launch"])
        // The restart entry (the shared core's iOS shape) rides the
        // scenarioEntry override — the calendar-live leg's mechanism.
        serve.scenarioEntry = (
            accessor: dsh_runtime_res_scenario_session_persist_restart_web_live_js,
            path: "web-live/session-persist-restart.js"
        )
        serve.onRuntimeFailure = { [weak self] message in
            guard let self else { return }
            self.finish(self.failOutcome("persist-restart: \(message)"))
        }
        // The scenario's completion IS this leg's verdict — on BOTH launches
        // (create settles PASS, the runner kills; resume settles PASS, done).
        serve.onRuntimeSettled = { [weak self] passed, message in
            guard let self else { return }
            self.finish(passed
                ? JsOutcome(completed: true, passed: true, error: "",
                    canonicalLines: self.eventLog.lines)
                : self.failOutcome("persist-restart: runtime scenario failed: \(message)"))
        }
        do {
            try serve.start()
        } catch {
            finish(failOutcome("persist-restart bootstrap: \(error)"))
        }
    }

    private func armWatchdog() {
        let item = DispatchWorkItem { [weak self] in
            guard let self, !self.finished else { return }
            self.finish(self.failOutcome(
                "persist-restart watchdog: drive did not complete in \(Self.watchdogSeconds)s"))
        }
        watchdog = item
        DispatchQueue.global().asyncAfter(
            deadline: .now() + .seconds(Self.watchdogSeconds), execute: item)
    }

    private func failOutcome(_ message: String) -> JsOutcome {
        print("rt: persist-restart FAIL \(message)")
        fflush(stdout)
        NSLog("%@", "rt: persist-restart FAIL \(message)")
        return JsOutcome(
            completed: false, passed: false, error: message,
            canonicalLines: eventLog.lines
        )
    }

    private func finish(_ outcome: JsOutcome) {
        guard !finished else { return }
        finished = true
        watchdog?.cancel()
        serve.stop()
        print("rt: persist-restart drive finished verdict=\(outcome.verdict)")
        fflush(stdout)
        DispatchQueue.main.async { [weak self] in
            self?.completion?(outcome)
            self?.completion = nil
        }
    }
}
