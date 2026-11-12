import UIKit

/// CardPlayerSurface — the NATIVE half of the plugin card contract (PR-1 of
/// the create-approve-hotmount-native loop). A cordis plugin speaks bus lines
/// (`card.present` / `card.state` / `card.dismiss` / `card.complete`); this
/// surface renders them as a live card floating over the app's own chrome —
/// the plugin manifests in the app, NOT as an HTML page (the owner's
/// explicit product bar).
///
/// The pomodoro shape drives the design: `kind: "timer"` cards carry a
/// `durationMs` and the surface ticks locally between authoritative
/// `card.state` patches, so a once-per-second plugin tick still renders a
/// smooth countdown (and the card survives a dropped tick honestly — the
/// next patch resnaps the remaining time).
///
/// face.card@1 (R3 pilot): this surface is now a GENERIC renderer of the
/// declarative payload — `schemaVersion` read (a future version renders
/// legacy + one structured warn), `card.actions: [{id, label}]` render as
/// real buttons, a missing id is REFUSED with a warn instead of silently
/// dropped, an unknown kind degrades to `info` with a warn, and the user's
/// acts return to the runtime as `card.action` events over the delivery
/// path `question.answer` already uses (`postAction` → SessionServe's
/// runtime bridge). Dismissal authority stays the plugin's: the local close
/// is OBSERVABLE (the producer hears it and may react), never authoritative.
///
/// UIKit on purpose: the app's window is UIKit-built; hosting SwiftUI here
/// would add a lifetime bridge for no gain.
/// One declarative face.card@1 action: `{id, label}` renders as a button.
typealias CardActionSpec = (id: String, label: String)

final class CardPlayerSurface {
    private weak var hostView: UIView?
    private var cardView: CardView?
    private var tickTimer: Timer?
    private var card: [String: Any] = [:]
    private var cardId = ""
    /// face.card@1 the payload declared (0 = legacy — today's exact shape).
    private var cardSchemaVersion = 0
    /// One terminal action per presented card (`close` beats a pending
    /// button — the v1 order guarantee); re-armed by every present.
    private var actionTerminal = false

    /// The host→runtime action delivery — the SAME runtime bridge the
    /// question answer rides (SessionServe.deliverRuntime). The drive wires
    /// it; nil (a seat without a runtime bridge) makes actions local-only.
    var postAction: (([String: Any]) -> Void)?

    // The local tick model: authoritative fields from card.state, plus the
    // instant the local countdown anchored to.
    private var remainingMs: Double = 0
    private var anchor: Date = .init()

    final class CardView: UIView {
        let titleLabel = UILabel()
        let timeLabel = UILabel()
        let subtitleLabel = UILabel()
        let progress = UIProgressView(progressViewStyle: .default)
        let closeButton = UIButton(type: .system)
        let actionsStack = UIStackView()
        /// The rendered declarative actions: (actionId, button) pairs.
        var actionButtons: [(id: String, button: UIButton)] = []
    }

    func attach(to view: UIView) {
        hostView = view
    }

    /// The projection-consistency read for the GET /api/state seam: what
    /// the NATIVE face holds right now, so a drive can assert that runtime
    /// truth (the bus records), the page projection, and this surface all
    /// agree. Main-thread only — the snapshot endpoint hops here
    /// synchronously from its own queue.
    func snapshot() -> [String: Any] {
        var face: [String: Any] = [
            "attached": hostView != nil,
            "visible": cardView != nil,
        ]
        if cardView != nil, let id = card["id"] as? String {
            face["id"] = id
            face["title"] = (card["title"] as? String) ?? id
            face["kind"] = (card["kind"] as? String) ?? "info"
            if let label = card["label"] as? String { face["label"] = label }
            if let subtitle = card["subtitle"] as? String { face["subtitle"] = subtitle }
            if !cardView!.actionButtons.isEmpty {
                face["actions"] = cardView!.actionButtons.map { $0.id }
            }
        }
        return ["card": face]
    }

    // ---- the four contract events -------------------------------------------

    /// Main-thread only (the drive hops bus events onto main before calling).
    func handle(_ msg: [String: Any]) {
        guard let type = msg["type"] as? String else { return }
        switch type {
        case "card.present": present(msg)
        case "card.state": state(msg)
        case "card.complete": complete(msg)
        case "card.dismiss": dismiss()
        default: break
        }
    }

    private func present(_ msg: [String: Any]) {
        // face.card@1 degradation ladder (never crash, never silent): a
        // future schemaVersion renders legacy (unknown fields ignored) with
        // one structured warn; a missing id is refused AND warned — the
        // honesty fix for the silent drop every host shipped before.
        cardSchemaVersion = msg["schemaVersion"] as? Int ?? 0
        if cardSchemaVersion > 1 {
            GatewayCore.uiMarker("card-degrade", "schema-\(cardSchemaVersion)")
        }
        guard var card = msg["card"] as? [String: Any] else {
            GatewayCore.uiMarker("card-degrade", "missing-card")
            return
        }
        guard let id = card["id"] as? String, !id.isEmpty else {
            GatewayCore.uiMarker("card-degrade", "missing-id")
            return
        }
        var kind = card["kind"] as? String ?? "info"
        if !["info", "timer"].contains(kind) {
            GatewayCore.uiMarker("card-degrade", "kind-\(kind)")
            kind = "info"
        }
        // The declarative actions (v1-add): [{id, label}] render as real
        // buttons; malformed entries drop with one warn (the card renders).
        var actions: [CardActionSpec] = []
        if let rawActions = card["actions"] as? [[String: Any]] {
            for entry in rawActions {
                if let actionId = entry["id"] as? String, !actionId.isEmpty,
                   let label = entry["label"] as? String {
                    actions.append((id: actionId, label: label))
                }
            }
            if actions.count != rawActions.count {
                GatewayCore.uiMarker("card-degrade", "actions-dropped")
            }
        } else if card["actions"] != nil {
            GatewayCore.uiMarker("card-degrade", "actions-type")
        }
        card["kind"] = kind // the degraded kind is what renders (snapshot truth)
        self.card = card
        cardId = id
        actionTerminal = false
        remainingMs = (card["durationMs"] as? Double) ?? 0
        anchor = Date()
        showCard(id: id, title: card["title"] as? String ?? id,
                 subtitle: card["subtitle"] as? String,
                 kind: kind, actions: actions)
        GatewayCore.uiMarker("card-present", "wait")
    }

    private func state(_ msg: [String: Any]) {
        guard cardView != nil, let state = msg["state"] as? [String: Any] else { return }
        if let remaining = state["remainingMs"] as? Double {
            remainingMs = remaining
            anchor = Date()
        }
        if let label = state["label"] as? String {
            cardView?.subtitleLabel.text = label
        }
        render()
    }

    private func complete(_ msg: [String: Any]) {
        guard cardView != nil else { return }
        remainingMs = 0
        cardView?.subtitleLabel.text = (msg["message"] as? String) ?? "完成"
        render()
        GatewayCore.uiMarker("card-present", "done")
        scriptActionIfAsked()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
            self?.dismiss()
        }
    }

    private func dismiss() {
        tickTimer?.invalidate()
        tickTimer = nil
        guard let view = cardView else { return }
        UIView.animate(withDuration: 0.3, animations: {
            view.alpha = 0
            view.transform = CGAffineTransform(translationX: 0, y: 60)
        }, completion: { _ in
            view.removeFromSuperview()
        })
        cardView = nil
    }

    // ---- face.card@1 user actions (host → runtime) --------------------------

    /// One `card.action` event per user act: `{id, action: close | drag-end
    /// | button, actionId?, at}`. The close is terminal-once per presented
    /// card; buttons are not terminal (a producer may collect several).
    private func postCardAction(_ action: String, actionId: String?) {
        if action == "close" {
            if actionTerminal { return }
            actionTerminal = true
        }
        guard let bridge = postAction else { return }
        var event: [String: Any] = [
            "type": "card.action",
            "id": cardId,
            "action": action,
            "at": Int(Date().timeIntervalSince1970 * 1000),
        ]
        if let actionId { event["actionId"] = actionId }
        bridge(event)
    }

    /// The scripted-action test seam (`-dsh-script-card-action button:<id>`
    /// — the approval seam's shape, UIPrimitives.scriptAnswerIfAsked): 1s
    /// after card.complete the named declarative button fires exactly the
    /// way a tap would, so the E2E drive proves the action round-trip
    /// without WDA. Absent the flag the human acts; the product default is
    /// unchanged.
    private func scriptActionIfAsked() {
        guard let script = Self.scriptedCardActionFlag(),
              cardView != nil else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            guard let self, let view = self.cardView else { return }
            guard script.hasPrefix("button:") else { return }
            let actionId = String(script.dropFirst("button:".count))
            GatewayCore.uiMarker("card-action", "script")
            guard let match = view.actionButtons.first(where: { $0.id == actionId }) else {
                return
            }
            self.postCardAction("button", actionId: actionId)
            match.button.isEnabled = false
        }
    }

    /// Reads the launch flag (drives relaunch per leg, so no caching).
    static func scriptedCardActionFlag() -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let flag = args.firstIndex(of: "-dsh-script-card-action"),
              flag + 1 < args.count else { return nil }
        return args[flag + 1]
    }

    // ---- rendering ------------------------------------------------------------

    private func showCard(id: String, title: String, subtitle: String?, kind: String,
        actions: [CardActionSpec]) {
        dismiss()
        guard let host = hostView else { return }
        let card = buildCardView(id: id, title: title, subtitle: subtitle,
            kind: kind, actions: actions)
        placeCard(card, in: host, actions: !actions.isEmpty)
        cardView = card
        card.alpha = 0
        card.transform = CGAffineTransform(translationX: 0, y: 60)
        UIView.animate(withDuration: 0.4, delay: 0, usingSpringWithDamping: 0.8,
                       initialSpringVelocity: 0.4) {
            card.alpha = 1
            card.transform = .identity
        }
        render()
        // The local tick: between authoritative state patches the countdown
        // runs on the main run loop; the run loop never touches the runtime.
        tickTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) {
            [weak self] _ in self?.render()
        }
    }

    private func buildCardView(
        id: String, title: String, subtitle: String?, kind: String,
        actions: [CardActionSpec]
    ) -> CardView {
        let card = CardView(frame: .zero)
        card.backgroundColor = .secondarySystemBackground
        card.layer.cornerRadius = 18
        card.layer.shadowColor = UIColor.black.cgColor
        card.layer.shadowOpacity = 0.18
        card.layer.shadowRadius = 14
        card.layer.shadowOffset = CGSize(width: 0, height: 6)

        card.titleLabel.text = title
        card.titleLabel.font = .systemFont(ofSize: 15, weight: .semibold)

        // Non-timer cards (calendar/info/…): no countdown — the subtitle IS
        // the face (a calendar shows its date line, not 00:00).
        if kind != "timer" {
            card.timeLabel.font = .systemFont(ofSize: 20, weight: .medium)
        } else {
            card.timeLabel.font = .monospacedDigitSystemFont(ofSize: 44, weight: .medium)
        }
        card.timeLabel.textAlignment = .center
        card.timeLabel.adjustsFontSizeToFitWidth = true
        card.timeLabel.numberOfLines = kind == "timer" ? 1 : 3

        card.subtitleLabel.text = subtitle ?? ""
        card.subtitleLabel.font = .systemFont(ofSize: 13)
        card.subtitleLabel.textColor = .secondaryLabel
        card.subtitleLabel.textAlignment = .center

        card.progress.progressViewStyle = .default
        card.progress.progressTintColor = kind == "timer"
            ? .systemOrange : .systemBlue
        if kind != "timer" { card.progress.alpha = 0 }

        wireChrome(card, actions: actions)
        return card
    }

    /** The declarative action buttons (face.card@1 `actions`): one row of
     * real buttons; a tap posts the `card.action {action:"button"}` event. */
    private func wireActions(_ card: CardView, actions: [CardActionSpec]) {
        card.actionsStack.axis = .horizontal
        card.actionsStack.spacing = 8
        card.actionsStack.distribution = .fillEqually
        for action in actions {
            let button = UIButton(type: .system)
            button.setTitle(action.label, for: .normal)
            button.titleLabel?.font = .systemFont(ofSize: 13, weight: .medium)
            button.layer.cornerRadius = 9
            button.backgroundColor = .tertiarySystemBackground
            let actionId = action.id
            button.addAction(UIAction { [weak self] _ in
                self?.postCardAction("button", actionId: actionId)
            }, for: .touchUpInside)
            card.actionsStack.addArrangedSubview(button)
            card.actionButtons.append((id: action.id, button: button))
        }
        if actions.isEmpty { card.actionsStack.isHidden = true }
    }

    /** The close ✕ + drag gesture + the subview layout — the chrome a card
     * needs to be a movable, closable, tappable PiP widget. */
    private func wireChrome(_ card: CardView, actions: [CardActionSpec]) {
        card.closeButton.setImage(UIImage(systemName: "xmark"), for: .normal)
        card.closeButton.tintColor = .secondaryLabel
        card.closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)

        card.addGestureRecognizer(UIPanGestureRecognizer(
            target: self, action: #selector(dragCard(_:))))

        wireActions(card, actions: actions)

        for sub in [card.titleLabel, card.timeLabel, card.subtitleLabel, card.progress,
                    card.actionsStack, card.closeButton] {
            sub.translatesAutoresizingMaskIntoConstraints = false
            card.addSubview(sub)
        }
        NSLayoutConstraint.activate([
            card.closeButton.topAnchor.constraint(equalTo: card.topAnchor, constant: 6),
            card.closeButton.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -6),
            card.closeButton.widthAnchor.constraint(equalToConstant: 26),
            card.closeButton.heightAnchor.constraint(equalToConstant: 26),
            card.titleLabel.topAnchor.constraint(equalTo: card.topAnchor, constant: 16),
            card.titleLabel.centerXAnchor.constraint(equalTo: card.centerXAnchor),
            card.timeLabel.topAnchor.constraint(equalTo: card.titleLabel.bottomAnchor, constant: 8),
            card.timeLabel.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            card.timeLabel.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            card.progress.topAnchor.constraint(equalTo: card.timeLabel.bottomAnchor, constant: 10),
            card.progress.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            card.progress.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),
            card.subtitleLabel.topAnchor.constraint(equalTo: card.progress.bottomAnchor, constant: 8),
            card.subtitleLabel.centerXAnchor.constraint(equalTo: card.centerXAnchor),
            card.actionsStack.topAnchor.constraint(
                equalTo: card.subtitleLabel.bottomAnchor, constant: 8),
            card.actionsStack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            card.actionsStack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            card.actionsStack.heightAnchor.constraint(equalToConstant: 30),
        ])
    }

    /// Frame placement, TOP-anchored under the safe area (the composer is
    /// bottom-docked — a bottom card covered the input): the card is a PiP
    /// widget the user can DRAG anywhere, TAP its declarative actions, and
    /// CLOSE locally; the close and the taps return as `card.action` events
    /// (dismissal authority stays the plugin's — a locally closed card just
    /// ignores later card.state/complete records and the next card.present
    /// re-shows it).
    private func placeCard(_ card: CardView, in host: UIView, actions: Bool) {
        let inset: CGFloat = 12
        let width = min(host.bounds.width - inset * 2, 420)
        let top = host.safeAreaInsets.top + inset
        let height: CGFloat = actions ? 196 : 148
        let frame = CGRect(x: host.bounds.width - width - inset, y: top,
            width: width, height: height)
        card.frame = frame
        host.addSubview(card)
    }

    /** The drag: reposition the floating card within the host bounds. */
    @objc private func dragCard(_ gesture: UIPanGestureRecognizer) {
        guard let card = gesture.view, let host = card.superview else { return }
        let t = gesture.translation(in: host)
        gesture.setTranslation(.zero, in: host)
        let halfW = card.bounds.width / 2 + 4
        let halfH = card.bounds.height / 2 + 4
        let x = min(max(card.center.x + t.x, halfW), host.bounds.width - halfW)
        let y = min(max(card.center.y + t.y, halfH), host.bounds.height - halfH)
        card.center = CGPoint(x: x, y: y)
        if gesture.state == .ended {
            postCardAction("drag-end", actionId: nil)
        }
    }

    @objc private func closeTapped() {
        postCardAction("close", actionId: nil)
        dismiss()
    }

    private func render() {
        guard let view = cardView else { return }
        if (card["kind"] as? String) != "timer" {
            // Non-timer cards: the label face (a calendar's date line) —
            // no countdown clock on a card that isn't counting.
            view.timeLabel.text = (card["label"] as? String)
                ?? view.subtitleLabel.text ?? ""
            return
        }
        let elapsed = Date().timeIntervalSince(anchor) * 1000
        let current = max(0, remainingMs - elapsed)
        let total = (card["durationMs"] as? Double) ?? 0
        view.timeLabel.text = Self.clock(current)
        if total > 0 {
            view.progress.setProgress(Float(1 - current / total), animated: true)
        }
    }

    private static func clock(_ ms: Double) -> String {
        let total = Int(ms / 1000)
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}
