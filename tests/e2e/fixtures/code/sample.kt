// Kotlin (legacy stream mode): data classes, extension functions, when.
import java.io.File

data class Note(val path: String, val tags: List<String> = emptyList()) {
    val size: Long get() = File(path).length()
}

fun List<Note>.groupByTag(): Map<String, List<Note>> =
    flatMap { n -> n.tags.map { it to n } }
        .groupBy({ it.first }, { it.second })

fun describe(n: Int) = when {
    n == 0 -> "no tags"
    n > 100 -> "many tags: $n"
    else -> "$n tags"
}

fun main() {
    val notes = listOf(Note("a.md", listOf("x")), Note("b.md"))
    println(describe(notes.groupByTag().size))
}
