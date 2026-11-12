import Foundation

/// One settled primitive call. `payload` is JSON-serializable (a dictionary,
/// an array, a String, a number, or NSNull for void/null results).
typealias GatewayDone = (Result<Any, GatewayError>) -> Void

/// Handler signature: runs OFF the runtime thread; must call `done` exactly
/// once (from any thread — the core routes the settle back onto the runtime
/// queue, ARCHITECTURE.md §6 thread rules).
typealias GatewayHandler = (GatewayCall, @escaping GatewayDone) -> Void

/// Arguments of one primitive call, decoded from the bridge's args JSON.
/// Bytes ride base64 in fields ending "B64" (frozen bridge convention).
struct GatewayCall {
    let callId: Int
    let args: [String: Any]

    func string(_ key: String) -> String? { args[key] as? String }

    func bool(_ key: String, default def: Bool = false) -> Bool {
        args[key] as? Bool ?? def
    }

    func dict(_ key: String) -> [String: Any] { args[key] as? [String: Any] ?? [:] }

    /// Decodes a base64 byte field ("<key>B64"); nil when absent/malformed.
    func b64(_ key: String) -> Data? {
        guard let text = string(key) else { return nil }
        return Data(base64Encoded: text)
    }
}

/// Contract §3 GatewayError — one structured rejection per failed call.
/// Codes are the closed set of primitives.md (unknown codes are fatal).
struct GatewayError: Error {
    let code: String
    let primitive: String
    let message: String
}

/// The caller's manifest (data-protocols.md §2), read from the staged bundle
/// root. Fail-loud: a missing or malformed manifest aborts the session.
struct GatewayManifest {
    static let caller = "dsh.runtime.scenario"
    let id: String
    let required: [String]

    init(bundleRoot: URL) throws {
        let url = bundleRoot.appendingPathComponent("manifest.json")
        guard let data = FileManager.default.contents(atPath: url.path),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else {
            throw GatewayError(code: "io", primitive: "manifest",
                message: "bundle_root/manifest.json missing or unparseable")
        }
        guard obj["schemaVersion"] as? Int == 1, let id = obj["id"] as? String,
              let caps = obj["capabilities"] as? [String: Any],
              let required = caps["required"] as? [String]
        else {
            throw GatewayError(code: "io", primitive: "manifest",
                message: "manifest.json violates schemaVersion 1 shape")
        }
        self.id = id
        self.required = required
        guard id == Self.caller else {
            throw GatewayError(code: "io", primitive: "manifest",
                message: "unexpected caller identity \(id)")
        }
    }

    /// Permission-flag grammar: `<name>` or `<name>@<major>` — the caller
    /// holds the flag when any required entry names the primitive exactly,
    /// with a major suffix, or through the primitive's capability FAMILY
    /// flag (v1.5.0: one flag may gate two primitives — `clipboard` gates
    /// both clipboard rows; the capability plane's `microphone` gates the
    /// mic pair, v1.10.0 candidate).
    private static let familyFlags: [String: String] = [
        // v1.11.0 durable-fs pair: the frozen table gates them under the
        // existing fs flags (rows 32/33 — fsPublishAtomic rides fsWrite,
        // fsSync rides fsRead), the same one-flag-two-primitives rule.
        "fsPublishAtomic": "fsWrite",
        "fsSync": "fsRead",
        "clipboardRead": "clipboard",
        "clipboardWrite": "clipboard",
        "presentShare": "share",
        "keepAwake": "screen",
        "cameraCapture": "camera",
        "cameraRecordStart": "camera",
        "cameraRecordStop": "camera",
        "bleScanStart": "ble",
        "bleScanStop": "ble",
        "bleConnect": "ble",
        "bleDisconnect": "ble",
        "bleRead": "ble",
        "bleWrite": "ble",
        "bleSubscribe": "ble",
        "bleUnsubscribe": "ble",
        "micStart": "microphone",
        "micStop": "microphone",
    ]

    func grants(primitive: String) -> Bool {
        let names = [primitive, Self.familyFlags[primitive]].compactMap { $0 }
        return required.contains { grant in
            names.contains { $0 == grant || grant.hasPrefix($0 + "@") }
        }
    }

    /// True when the primitive belongs to a capability FAMILY row (the
    /// capability plane's promptable surface — the camera/mic lines join
    /// with their own rows).
    static func isCapabilityRow(_ primitive: String) -> Bool {
        familyFlags[primitive] != nil
    }
}

/// The capability gateway core: dispatch table name→handler, permission
/// enforcement against the manifest, and the mandatory structured audit of
/// primitives.md §6 — one record per call, never payload contents. Audit
/// lines use their own stdout prefix ("dsh.gateway.audit: ") so the
/// canonical "dsh.runtime.log: " E2E stream stays one-to-one.
///
/// The RuntimeDescriptor is REGISTRATION-DERIVED (contract/proposals/
/// 2026-11-13-capability-bus.md, step B): the name list is what
/// `registerStandardPrimitives` actually wires — recorded as registration
/// completes — and each declared row's self-description comes from the
/// generated facts table below (tools/generated/capability-registry.json,
/// emitted by tools/check-descriptor-parity.mjs --emit, checked statically
/// against the registration flow by the same tool). There is no hand serving
/// list left to drift.
final class GatewayCore {
    /// One row's per-entry self-description (the descriptor-plane grammar:
    /// the contract schema version the row speaks, its audit class, and its
    /// permission flag — nil for flagless rows like deviceInfo). The struct
    /// is the hand-written shape; the VALUES below are generator-owned.
    struct PrimitiveFact {
        let schemaVersion: Int
        let auditClass: String
        let permissionFlag: String?
    }

    // dsh:capability-registry:begin#facts (generated by tools/check-descriptor-parity.mjs --emit — do not edit by hand)
    static let primitiveFacts: [String: PrimitiveFact] = [
        "fsRead": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "fsRead"),
        "fsWrite": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "fsWrite"),
        "fsScope": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "fsScope"),
        "httpFetch": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "httpFetch"),
        "notify": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "notify"),
        "presentApproval": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "presentApproval"),
        "presentPicker": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "presentPicker"),
        "keychainGet": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "keychainGet"),
        "keychainSet": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "keychainSet"),
        "fsStat": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "fsRead"),
        "fsList": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "fsRead"),
        "fsMkdir": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "fsWrite"),
        "fsRemove": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "fsWrite"),
        "fsRename": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "fsWrite"),
        "wasmRun": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "wasm"),
        "ishRun": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "ishRun"),
        "timerSchedule": PrimitiveFact(schemaVersion: 1, auditClass: "unaudited", permissionFlag: "timer"),
        "timerCancel": PrimitiveFact(schemaVersion: 1, auditClass: "unaudited", permissionFlag: "timer"),
        "deviceInfo": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: nil),
        "haptic": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "haptic"),
        "clipboardRead": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "clipboard"),
        "clipboardWrite": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "clipboard"),
        "presentShare": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "share"),
        "keepAwake": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "screen"),
        "socketListen": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "socket"),
        "socketConnect": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "socket"),
        "channelOpen": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "channel"),
        "channelClose": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "channel"),
        "presentSurface": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "surface"),
        "surfaceDraw": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "surface"),
        "closeSurface": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "surface"),
        "fsPublishAtomic": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "fsWrite"),
        "fsSync": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "fsRead"),
        "cameraCapture": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "camera"),
        "cameraRecordStart": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "camera"),
        "cameraRecordStop": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "camera"),
        "bleScanStart": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "ble"),
        "bleScanStop": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "ble"),
        "bleConnect": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "ble"),
        "bleDisconnect": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "ble"),
        "bleRead": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "ble"),
        "bleWrite": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "ble"),
        "bleSubscribe": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "ble"),
        "bleUnsubscribe": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "ble"),
        "micStart": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "microphone"),
        "micStop": PrimitiveFact(schemaVersion: 1, auditClass: "audited", permissionFlag: "microphone"),
    ]
    // dsh:capability-registry:end#facts

    /// The capability plane's PHASED rows (proposal v1.10.0): shapes on
    /// record, implementations follow as their own changes — declared
    /// unavailable, and their handlers answer `unavailable`.
    static let phasedRows = ["cameraRecordStart", "cameraRecordStop"]
    static let auditPrefix = "dsh.gateway.audit: "

    /// Registers the full serving table on this core — the registration
    /// flow the descriptor is derived from (descriptorJSON). Returns the
    /// notify primitive so a session can keep a strong ref for its app.state
    /// forwarding (the center's delegate is weak).
    func registerStandardPrimitives(bleRadio: BleRadio? = nil) -> NotifyPrimitive {
        let fs = FSPrimitives()
        fs.register(on: self)
        _ = HTTPPrimitive(core: self)
        _ = KeychainPrimitives(core: self)
        _ = UIPrimitives(core: self, fs: fs)
        _ = DevicePlanePrimitives(core: self, fs: fs)
        _ = ClipboardPrimitives(core: self)
        _ = CameraPrimitives(core: self, fs: fs)
        _ = BLEPrimitives(core: self, radio: bleRadio ?? SystemBleRadio())
        _ = MicPrimitives(core: self)
        _ = TimerPrimitives(core: self)
        return NotifyPrimitive(core: self)
    }

    let manifest: GatewayManifest
    private let workQueue = DispatchQueue(label: "org.dsh.gateway.work")
    private var handlers: [String: GatewayHandler] = [:]
    private let auditLock = NSLock()

    /// Wired by the session; each hops onto the runtime thread (the only
    /// thread allowed to touch the C runtime).
    var settle: ((Int, Bool, String) -> Void)?
    var emit: ((String) -> Void)?

    init(bundleRoot: URL) throws {
        manifest = try GatewayManifest(bundleRoot: bundleRoot)
    }

    /// The registration flow's own record: every name register() wired, in
    /// registration order — the runtime truth the descriptor is derived
    /// from (the identity the old hand list demanded by comment discipline).
    private(set) var registrationOrder: [String] = []

    func register(name: String, _ handler: @escaping GatewayHandler) {
        registrationOrder.append(name)
        handlers[name] = handler
    }

    /// The descriptor rows this core actually wired: the base name of every
    /// registration, in first-appearance order (dotted sub-verbs fold into
    /// their contract row — fsScope.persist/resolve ride fsScope,
    /// httpFetch.abort rides httpFetch).
    private var descriptorRows: [String] {
        var rows: [String] = []
        for name in registrationOrder {
            let base = name.split(separator: ".").first.map(String.init) ?? name
            if !rows.contains(base) { rows.append(base) }
        }
        return rows
    }

    /// The RuntimeDescriptor JSON, built from the registration flow + the
    /// generated per-entry facts — never a hand list. A declared row the
    /// registry does not know fails loud (rule 5): a newly registered row
    /// must join tools/generated/capability-registry.json first (the
    /// descriptor-parity gate enforces the same identity statically).
    /// `declarePhasedUnavailable` is the site's honest-absence posture: the
    /// full binding face (GatewaySession) declares the phased recording rows
    /// unavailable; the headless faces declare only what they serve.
    func descriptorJSON(declarePhasedUnavailable: Bool) -> String {
        let phased = Set(Self.phasedRows)
        let rows = descriptorRows
        let available = rows.filter { !phased.contains($0) }
        let unavailable = declarePhasedUnavailable
            ? Self.phasedRows.filter { rows.contains($0) }
            : []
        var entries: [[String: Any]] = []
        for name in available + unavailable {
            guard let fact = Self.primitiveFacts[name] else {
                fatalError("descriptor: declared row \(name) has no capability-registry fact — "
                    + "add it to tools/generated/capability-registry.json and run "
                    + "node tools/check-descriptor-parity.mjs --emit")
            }
            entries.append([
                "name": name,
                "schemaVersion": fact.schemaVersion,
                "auditClass": fact.auditClass,
                "permissionFlag": fact.permissionFlag ?? NSNull(),
            ])
        }
        return Self.jsonLine([
            "available": available,
            "unavailable": unavailable,
            "entries": entries,
        ]) ?? "{}"
    }

    private let detailLock = NSLock()
    private var pendingDetail: [String: Any]?

    /// The v1.5.0 audit-detail seam: a handler stages the closed-vocabulary
    /// facts §6 names for the device plane (pattern / hold / share kind) and
    /// the Done wrapper folds them into the call's ONE audit line. Stage
    /// before settling; the runtime's serial dispatch keeps slots from
    /// interleaving in practice.
    func stageAuditDetail(_ detail: [String: Any]?) {
        detailLock.lock()
        pendingDetail = detail
        detailLock.unlock()
    }

    private func takeAuditDetail() -> [String: Any]? {
        detailLock.lock()
        defer { detailLock.unlock() }
        let detail = pendingDetail
        pendingDetail = nil
        return detail
    }

    /// The capability plane's out-of-scope rule (the socket seam's
    /// "--prompt" posture, the proposal's rule 2): a REGISTERED capability-
    /// family primitive the caller lacks the grant for raises the runtime
    /// prompt instead of the flat denial. Installed by the capability
    /// primitives at registration; grant proceeds to the handler, deny
    /// settles exactly like the flat path. nil (every pre-capability
    /// session) keeps the v1.5.0 behavior byte-for-byte.
    var capabilityPrompter: ((_ primitive: String, _ grant: @escaping () -> Void,
        _ deny: @escaping () -> Void) -> Void)?

    /// Entry point of the frozen bridge's on_call — invoked ON THE RUNTIME
    /// THREAD. Unknown or ungranted primitives settle denied with a "denied"
    /// audit verdict; granted calls run their handler off-thread.
    func dispatch(callId: Int, name: String, argsJSON: String) {
        if name == "httpFetch.abort" { return dispatchAbort(callId, argsJSON) }
        let base = name.split(separator: ".").first.map(String.init) ?? name
        let granted = manifest.grants(primitive: base)
        if granted || capabilityPrompter == nil || !GatewayManifest.isCapabilityRow(base) {
            return dispatchKnown(callId: callId, name: name, argsJSON: argsJSON,
                enforceGrant: !granted)
        }
        // ungranted capability row + a prompter installed: raise the
        // prompt; the grant path re-enters with the check bypassed (the
        // prompt layer's session grant substitutes for the manifest flag)
        capabilityPrompter?(name, { [weak self] in
            self?.dispatchKnown(callId: callId, name: name, argsJSON: argsJSON,
                enforceGrant: false)
        }, { [weak self] in
            self?.audit(primitive: name, verdict: "denied", outcome: "denied")
            let message = "primitive not granted to \(self?.manifest.id ?? "")"
            let error = GatewayError(code: "denied", primitive: name, message: message)
            self?.settle?(callId, false, Self.errorJSON(error))
        })
    }

    /// The known-primitive continuation of dispatch; `enforceGrant` is
    /// false only on the prompt layer's grant path (the runtime approval
    /// substitutes for the manifest flag — session-scoped by the
    /// prompter's own bookkeeping).
    private func dispatchKnown(
        callId: Int, name: String, argsJSON: String, enforceGrant: Bool
    ) {
        guard let handler = handlers[name],
            !enforceGrant || manifest.grants(primitive: name.split(separator: ".").first.map(String.init) ?? name)
        else {
            audit(primitive: name, verdict: "denied", outcome: "denied")
            let message = "primitive not granted to \(manifest.id)"
            let error = GatewayError(code: "denied", primitive: name, message: message)
            settle?(callId, false, Self.errorJSON(error))
            return
        }
        guard let data = argsJSON.data(using: .utf8),
              let args = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else {
            audit(primitive: name, verdict: "granted", outcome: "invalid")
            let error = GatewayError(
                code: "invalid", primitive: name, message: "args JSON unparseable")
            settle?(callId, false, Self.errorJSON(error))
            return
        }
        let call = GatewayCall(callId: callId, args: args)
        dispatchGranted(callId: callId, name: name, handler: handler, args: call)
    }

    /// Runs the handler on the work queue; the completion re-enters here for
    /// audit + the settle hop back onto the runtime queue.
    private func dispatchGranted(
        callId: Int, name: String, handler: @escaping GatewayHandler,
        args: GatewayCall
    ) {
        let done: GatewayDone = { [weak self] result in
            guard let self else { return }
            self.settleResult(callId, name: name, result: result)
        }
        workQueue.async { handler(args, done) }
    }

    /// The wrapper's one audit line + settle hop (extracted so the closure
    /// stays inside the indent budget). BOTH branches drain the staged
    /// detail — a failure settle that left it pending would leak into the
    /// NEXT call's audit line (measured: micStart's unavailable left its
    /// staged detail on micStop's row).
    private func settleResult(
        _ callId: Int, name: String, result: Result<Any, GatewayError>
    ) {
        switch result {
        case .success(let payload):
            audit(primitive: name, verdict: "granted", outcome: "ok",
                  detail: takeAuditDetail())
            settle?(callId, true, Self.encode(payload))
        case .failure(let error):
            audit(primitive: name, verdict: "granted", outcome: error.code,
                  detail: takeAuditDetail())
            settle?(callId, false, Self.errorJSON(error))
        }
    }

    /// Control-plane call of the frozen bridge: JS global __dshGatewayAbort
    /// arrives as on_call with name "httpFetch.abort", args {"callId":N}.
    /// The handler parses the target (number or "body:<callId>" string).
    /// Fire-and-forget: the C side assigns abort on_calls no pending call
    /// id, so — unlike primitives — they are audited but never settled.
    private func dispatchAbort(_ callId: Int, _ argsJSON: String) {
        let args = (try? JSONSerialization.jsonObject(with: Data(argsJSON.utf8)))
            as? [String: Any]
        handlers["httpFetch.abort"]?(GatewayCall(callId: -1, args: args ?? [:]), { _ in })
        audit(primitive: "httpFetch.abort", verdict: "granted", outcome: "ok")
    }

    // ---- audit (mandatory, host-fixed, never payload contents) -------------

    func audit(
        primitive: String, verdict: String, outcome: String,
        detail: [String: Any]? = nil
    ) {
        var record: [String: Any] = [
            "ts": Self.isoNow(),
            "primitive": primitive,
            "caller": manifest.id,
            "verdict": verdict,
            "outcome": outcome,
        ]
        if let detail { record["detail"] = detail }
        guard let line = Self.jsonLine(record) else { return }
        auditLock.lock()
        print(Self.auditPrefix + line)
        fflush(stdout)
        NSLog("%@", Self.auditPrefix + line)
        auditLock.unlock()
    }

    // ---- shared JSON helpers ------------------------------------------------

    static func errorJSON(_ error: GatewayError) -> String {
        let obj: [String: Any] = [
            "code": error.code, "primitive": error.primitive, "message": error.message,
        ]
        return jsonLine(obj) ?? "{}"
    }

    static func encode(_ payload: Any) -> String { jsonLine(payload) ?? "null" }

    static func jsonLine(_ obj: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(obj) || obj is NSNull else { return nil }
        if obj is NSNull { return "null" }
        guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func isoNow(_ date: Date = Date()) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    /// stdout automation marker (NOT the canonical stream) for the E2E
    /// driver: "rt: ui-wait <name>" before an automatable surface,
    /// "rt: ui-done <name>" once it resolves.
    static func uiMarker(_ name: String, _ phase: String) {
        print("rt: ui-\(phase) \(name)")
        fflush(stdout)
    }
}
