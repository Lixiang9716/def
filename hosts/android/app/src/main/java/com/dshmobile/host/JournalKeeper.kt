package com.dshmobile.host

import java.io.File

/** User state that lives INSIDE an asset-reconciled tree survives the
 * stamp-mismatch wipe: the session journal is <filesDir>/dsh/dsh/sessions
 * (the persistence root rides the synced tree), and an `install -r`
 * upgrade must never take it. Found live by the upgrade-matrix leg
 * (row 15): the B boot's stamp mismatch wiped the journal and the resumed
 * boot self-staged as a clean create. */
internal object JournalKeeper {

    /** Subtrees preserved across a synced tree's wipe, relative to it. */
    private val PRESERVED = setOf("dsh/sessions")

    /** Rename the preserved subtrees aside OUTSIDE the wiped tree (a child
     * aside would be taken by the very wipe they survive). */
    fun preserve(target: File): List<Pair<File, File>> {
        val kept = mutableListOf<Pair<File, File>>()
        for (name in PRESERVED) {
            val dir = File(target, name)
            if (dir.isDirectory) {
                val aside = File(target.parentFile, "${target.name}-${name.replace('/', '_')}.asset-keep")
                aside.deleteRecursively()
                if (dir.renameTo(aside)) kept.add(Pair(aside, dir))
            }
        }
        return kept
    }

    /** Rename the kept subtrees back after re-materialization; a restore
     * miss never wedges the boot. */
    fun restore(kept: List<Pair<File, File>>) {
        for ((aside, dir) in kept) {
            dir.parentFile?.mkdirs()
            if (!aside.renameTo(dir)) aside.deleteRecursively()
        }
    }
}
