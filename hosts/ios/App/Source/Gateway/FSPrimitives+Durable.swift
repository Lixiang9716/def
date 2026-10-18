import Darwin
import Foundation

/// The durable-fs pair (contract v1.11.0, adopted proposal
/// 2026-10-18-durable-fs-native): `fsPublishAtomic` — ONE host-side atomic
/// durable publish (same-directory temp → write → fsync → rename →
/// fsync(directory)) — and `fsSync`, the explicit durability barrier. Split
/// from FSPrimitives.swift at the code-size gate; rides the same scope
/// registry and the same security-scoped bracket (`inScope`).
///
/// Publish is RENAME-based by law of measurement, not preference: Android
/// SELinux denies link(2) for app domains on their own files (the #587
/// fs-port battery), so the link dance is dead contract-wide and Darwin
/// follows the same rename path. The trailing directory fsync is the
/// crash-durability of the rename itself — never omitted.
extension FSPrimitives {

    func registerDurable(on core: GatewayCore) {
        core.register(name: "fsPublishAtomic") { call, done in
            self.publishAtomic(call, done)
        }
        core.register(name: "fsSync") { call, done in self.sync(call, done) }
    }

    // ---- handlers -----------------------------------------------------------

    private func publishAtomic(_ call: GatewayCall, _ done: @escaping GatewayDone) {
        guard let (scope, rel) = target(call, primitive: "fsPublishAtomic", done)
        else { return }
        guard let bytes = call.b64("bytesB64") else {
            return done(.failure(Self.invalid("fsPublishAtomic", "missing bytesB64")))
        }
        inScope(scope) { base in
            done(Self.publish(base.appendingPathComponent(rel), bytes: bytes)
                .map { _ in ["written": bytes.count] })
        } onDenied: {
            done(.failure(Self.denied("fsPublishAtomic", scope)))
        }
    }

    private func sync(_ call: GatewayCall, _ done: @escaping GatewayDone) {
        guard let (scope, rel) = target(call, primitive: "fsSync", done) else { return }
        guard let kind = call.string("kind"), kind == "file" || kind == "dir" else {
            return done(.failure(Self.invalid("fsSync", "kind must be file|dir")))
        }
        inScope(scope) { base in
            done(Self.syncBarrier(base.appendingPathComponent(rel), kind: kind).map { $0 as Any })
        } onDenied: {
            done(.failure(Self.denied("fsSync", scope)))
        }
    }

    // ---- the POSIX dance -----------------------------------------------------

    /// The whole publish as one step, POSIX-exact. The parent directory must
    /// exist (fsMkdir first) — a missing parent rejects io before any byte
    /// is written; on any later failure the target is untouched and no temp
    /// residue remains, the reason naming the failing step.
    static func publish(_ dest: URL, bytes: Data) -> Result<Void, GatewayError> {
        let dir = dest.deletingLastPathComponent()
        guard FileManager.default.fileExists(atPath: dir.path) else {
            return .failure(stepError("fsPublishAtomic", "parent directory missing: fsMkdir first", dest))
        }
        let tmp = dir.appendingPathComponent("dsh-publish-\(UUID().uuidString).tmp")
        let fd = open(tmp.path, O_WRONLY | O_CREAT | O_EXCL, 0o600)
        guard fd >= 0 else {
            return .failure(stepError("fsPublishAtomic", "temp create failed", tmp))
        }
        var ok = bytes.withUnsafeBytes { raw -> Bool in
            guard let base = raw.bindMemory(to: UInt8.self).baseAddress, !bytes.isEmpty
            else { return bytes.isEmpty }
            var off = 0
            while off < bytes.count {
                let n = write(fd, base + off, bytes.count - off)
                if n <= 0 { return false }
                off += n
            }
            return true
        }
        if ok { ok = fsync(fd) == 0 }
        close(fd)
        if !ok {
            unlink(tmp.path)
            return .failure(stepError("fsPublishAtomic", "write/fsync failed", tmp))
        }
        if rename(tmp.path, dest.path) != 0 {
            unlink(tmp.path)
            return .failure(stepError("fsPublishAtomic", "rename failed", dest))
        }
        let dfd = open(dir.path, O_RDONLY | O_DIRECTORY)
        guard dfd >= 0 else {
            return .failure(stepError("fsPublishAtomic", "directory fsync failed", dir))
        }
        let drc = fsync(dfd)
        close(dfd)
        guard drc == 0 else {
            return .failure(stepError("fsPublishAtomic", "directory fsync failed", dir))
        }
        return .success(())
    }

    /// One explicit barrier by path. `kind` must match what the path is —
    /// each kind opens with its own mode (dir via O_DIRECTORY, file via
    /// O_RDWR) so a mismatch fails the open itself, the contract's io
    /// rejection with no stat-guessing.
    static func syncBarrier(_ url: URL, kind: String) -> Result<[String: Any], GatewayError> {
        let flags = kind == "dir" ? O_RDONLY | O_DIRECTORY : O_RDWR
        let fd = open(url.path, flags)
        guard fd >= 0 else {
            return .failure(stepError("fsSync", "open failed for kind \(kind)", url))
        }
        let rc = fsync(fd)
        close(fd)
        guard rc == 0 else {
            return .failure(stepError("fsSync", "fsync failed", url))
        }
        return .success([:])
    }

    private static func stepError(
        _ primitive: String, _ step: String, _ url: URL
    ) -> GatewayError {
        GatewayError(
            code: "io", primitive: primitive,
            message: "\(step): \(url.lastPathComponent) (\(String(cString: strerror(errno))))")
    }
}
