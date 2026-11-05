import Foundation

/// The mux-frame delivery half (split from SessionServe at the code-size
/// gate): one runtime-pushed frame routed to the page-side bridge by
/// stream id — items, errors, and the stream end.
extension SessionServe {
    func deliverMuxFrame(_ msg: [String: Any]) {
        guard let streamId = msg["streamId"] as? String else { return }
        switch msg["type"] as? String {
        case "mux.item":
            guard let value = msg["value"] as? [String: Any] else { return }
            bridge?.muxItem(streamId: streamId, value: value)
        case "mux.error":
            let code = msg["code"] as? String ?? "gateway/unavailable"
            let details = msg["details"] as? [String: Any] ?? [:]
            let message = msg["message"] as? String ?? ""
            bridge?.muxError(streamId: streamId, code: code, message: message, details: details)
        default:
            bridge?.muxEnd(streamId: streamId)
        }
    }
}
