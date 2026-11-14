import Foundation
import UIKit

/// The user-facing serving boot — outgrew AppDelegate's file budget when #799
/// wired the scenario-settle failure channel; the release launch
/// (`AppDelegate.bootRelease`) calls it. The seat it constructs is the same
/// one `composer.live-write` verifies, so the path the manifest proves and
/// the path a user runs cannot drift apart.

extension AppDelegate {
    /// The user-facing serving boot: the `SessionServe` seat, with NO hooks
    /// assigned — the serving facts go nowhere, and the user drives the page.
    func runServingBoot() {
        let serve = SessionServe(
            credential: SessionServe.loadCredential(),
            interactive: true)
        self.serve = serve
        serve.onOrigin = { [weak self] origin in
            self?.webView?.load(URLRequest(url: origin))
        }
        // A plugin's live card renders in the app's OWN chrome (PR-1): the
        // serve/release seats surface the card.* bus lines natively.
        let surface = CardPlayerSurface()
        cardSurface = surface
        serve.onCardEvent = { [weak surface] msg in
            DispatchQueue.main.async { surface?.handle(msg) }
        }
        serve.cardState = { [weak surface] in surface?.snapshot() ?? [:] }
        if let host = webView?.superview {
            surface.attach(to: host)
        }
        // A failure here leaves an inert page, indistinguishable from an
        // idle one — say so on BOTH channels (screen + warn-keeping log).
        serve.onRuntimeFailure = { [weak self] message in
            NSLog("%@", "dsh.session.serve: runtime failed: \(message)")
            DispatchQueue.main.async { self?.showBootFailure(message) }
        }
        // A scenario's own `__dshComplete(false)` reaches onComplete, not
        // onFailure — and in release the fail gate's log record is stripped,
        // so without this the JS boot death is silent on every channel.
        serve.onRuntimeSettled = { [weak self] passed, message in
            guard !passed else { return }
            NSLog("%@", "dsh.session.serve: runtime failed: \(message)")
            DispatchQueue.main.async { self?.showBootFailure(message) }
        }
        do {
            try serve.start()
        } catch {
            NSLog("%@", "dsh.session.serve: bootstrap failed: \(error)")
            showBootFailure("\(error)")
        }
    }
}
