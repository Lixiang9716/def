import Foundation

/// Creating the C rt host, in ONE place, because the host has to declare its
/// launch environment to the JS spine *before* the entry module runs — and the
/// spine boots from four different drives (the plain runtime, the session
/// runtime, the carrier, the web-boot drive). An environment set on one path
/// and forgotten on another is worse than none: the JS layer then decides from
/// a fact that is true on one drive and false on the next.
///
/// The launch-env snapshot is the host's declaration channel to the JS spine:
/// the E2E runner's DSH_-prefixed process environment rides it — the parity
/// drive's mock endpoint (DSH_MOCK_LLM_URL/KEY) arrives that way, injected
/// through simctl's SIMCTL_CHILD_* inheritance (the simulator shares the
/// host's loopback, so the node-side mock is reachable). The guest-userland
/// fact that used to ride the same channel (DSH_ISH_ROOTFS with its
/// `ish.rootfs.declared` record) retired with the vendored iSH engine; the
/// `note` parameter stays as the launch-record channel and is currently
/// silent — no launch fact has taken the guest's place.
func dsh_runtime_new_declaring(
    _ bundleRoot: String,
    _ sink: inout dsh_runtime_sink,
    note: ((String) -> Void)? = nil
) -> OpaquePointer? {
    guard let host = dsh_runtime_new(bundleRoot, &sink) else { return nil }
    var env: [String: String] = ProcessInfo.processInfo.environment
        .filter { $0.key.hasPrefix("DSH_") }
    if !env.isEmpty,
       let data = try? JSONSerialization.data(withJSONObject: env),
       let json = String(data: data, encoding: .utf8) {
        dsh_runtime_set_launch_env(host, json)
    }
    return host
}
