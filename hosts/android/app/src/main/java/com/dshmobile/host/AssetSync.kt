package com.dshmobile.host

import android.content.Context
import java.io.File

/**
 * The stamped asset-tree reconciler (loop-g) — moved out of MainActivity at
 * the code-size gate: an overwrite-only copy let every entry an OLDER APK
 * shipped survive `install -r` forever — the device's files/rt/vendor/dsh
 * carried 274 pre-lean dirs the current closure never materializes, and no
 * clean-install proof could pass over them. The stamped manifest makes
 * drift loud and self-healing: matching stamp → no-op; missing or differing
 * stamp (first boot after this fix, a lean change, a new file) → wipe the
 * tree and re-materialize exactly the shipped set. Crash-safe: the stamp
 * lands only after the copy completes. Trees are app-owned scratch (the
 * workspace lives under files/profiles/, and the presets seed re-delivers
 * its rows every boot), so the wipe never takes user data with it.
 */
internal object AssetSync {

    /** The per-tree asset manifest stamp (sync). */
    private const val STAMP_NAME = ".dsh-asset-stamp"

    /** Copies the asset dsh bundle to filesDir/dsh preserving the layout. */
    fun materializeBundle(context: Context) {
        sync(context, "dsh", File(context.filesDir, "dsh"))
    }

    /** Reconciles one served tree with the APK's assets. */
    fun sync(context: Context, assetPath: String, target: File) {
        val stamp = File(target, STAMP_NAME)
        val names = sortedSetOf<String>()
        collectAssetNames(context, assetPath, "", names)
        val desired = names.joinToString("\n")
        if (stamp.isFile && stamp.readText() == desired) return
        if (target.exists()) target.deleteRecursively()
        target.mkdirs()
        for (rel in names) {
            val out = File(target, rel)
            out.parentFile?.mkdirs()
            copyAssetFile(context, "$assetPath/$rel", out)
        }
        stamp.writeText(desired)
    }

    /** The asset-set stamp written INSIDE each synced tree: the exact sorted
     * relative-path manifest of what the current APK ships. */
    private fun collectAssetNames(
        context: Context,
        assetPath: String,
        prefix: String,
        names: MutableSet<String>,
    ) {
        val children = context.assets.list(assetPath).orEmpty()
        if (children.isEmpty()) {
            names.add(prefix)
            return
        }
        for (child in children) {
            collectAssetNames(context, "$assetPath/$child", if (prefix.isEmpty()) child else "$prefix/$child", names)
        }
    }

    private fun copyAssetFile(context: Context, assetPath: String, target: File) {
        context.assets.open(assetPath).use { input ->
            target.outputStream().use { output -> input.copyTo(output) }
        }
    }
}
