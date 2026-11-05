package com.dshmobile.host

import android.content.res.AssetManager
import java.io.File

/**
 * AssetStager — the APK-asset → filesDir tree reconciler, split out of
 * MainActivity at the code-size gate (the same split SessionServeConfig
 * rode). One public face: [syncAssetDir] makes a served tree byte-match
 * the APK's shipped set; [materializeBundle] is the rt-bundle spelling.
 */
object AssetStager {

    /** The per-tree asset manifest stamp (syncAssetDir). */
    private const val ASSET_STAMP_NAME = ".dsh-asset-stamp"

    /** Copies the asset rt bundle to filesDir/rt preserving the layout. */
    fun materializeBundle(assets: AssetManager, filesDir: File) {
        syncAssetDir(assets, "dsh", File(filesDir, "dsh"))
    }

    /** The asset-set stamp written INSIDE each synced tree: the exact sorted
     * relative-path manifest WITH each file's CRC — a path-only stamp let a
     * same-list content change (a runtime fix inside an existing file) match
     * the old stamp and the stale tree serve forever (measured 2026-10-28:
     * the pi-ai collision fix rode a rebuilt APK while files/dsh kept the
     * pre-fix boot.js — the list was identical, the bytes were not). File
     * vs dir settles by OPENING: AssetManager.list() of a plain file returns
     * the file's own name on some images, so the list shape cannot be
     * trusted to walk the tree. */
    private fun collectAssetNames(assets: AssetManager, assetPath: String, prefix: String, names: MutableSet<String>) {
        val full = if (prefix.isEmpty()) assetPath else "$assetPath/$prefix"
        val crc = java.util.zip.CRC32()
        val isFile = try {
            assets.open(full).use { input ->
                val buf = ByteArray(8192)
                var n: Int
                while (input.read(buf).also { n = it } >= 0) crc.update(buf, 0, n)
            }
            true
        } catch (_: java.io.FileNotFoundException) {
            false
        }
        if (isFile) {
            names.add("$prefix:${crc.value}")
            return
        }
        for (child in assets.list(full).orEmpty()) {
            collectAssetNames(assets, assetPath, if (prefix.isEmpty()) child else "$prefix/$child", names)
        }
    }

    /** Reconciles one served tree with the APK's assets (loop-g): an
     * overwrite-only copy let every entry an OLDER APK shipped survive
     * `install -r` forever — the device's files/rt/vendor/dsh carried
     * 274 pre-lean dirs the current closure never materializes, and no
     * clean-install proof could pass over them. The stamped manifest makes
     * drift loud and self-healing: matching stamp → no-op; missing or
     * differing stamp (first boot after this fix, a lean change, a new
     * file) → wipe the tree and re-materialize exactly the shipped set.
     * Crash-safe: the stamp lands only after the copy completes. Trees are
     * app-owned scratch (the workspace lives under files/profiles/, and the
     * presets seed re-delivers its rows every boot), so the wipe never
     * takes user data with it. */
    fun syncAssetDir(assets: AssetManager, assetPath: String, target: File) {
        val stamp = File(target, ASSET_STAMP_NAME)
        val names = sortedSetOf<String>()
        collectAssetNames(assets, assetPath, "", names)
        val desired = names.joinToString("\n")
        if (stamp.isFile && stamp.readText() == desired) return
        // User state inside the tree (the session journal) survives the
        // wipe — see JournalKeeper.
        val kept = JournalKeeper.preserve(target)
        if (target.exists()) target.deleteRecursively()
        target.mkdirs()
        for (rel in names) {
            // The stamp entry carries the ":crc" suffix — the on-disk name is
            // the part before the LAST colon (a crc is all digits, so a path
            // colon can never sit this late); only the stamp text keeps it.
            val diskRel = rel.substringBeforeLast(':')
            val out = File(target, diskRel)
            out.parentFile?.mkdirs()
            copyAssetFile(assets, "$assetPath/$diskRel", out)
        }
        JournalKeeper.restore(kept)
        stamp.writeText(desired)
    }

    private fun copyAssetFile(assets: AssetManager, assetPath: String, target: File) {
        assets.open(assetPath).use { input ->
            target.outputStream().use { output -> input.copyTo(output) }
        }
    }
}
