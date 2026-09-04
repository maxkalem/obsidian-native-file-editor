// Groovy: closures, GStrings, maps, safe navigation.
import groovy.transform.Canonical

@Canonical
class Note {
    String path
    List<String> tags = []
    long size() { new File(path).length() }
}

final LIMIT = 5L * 1024 * 1024

def groupByTag(List<Note> notes) {
    notes.findAll { it.size() <= LIMIT }
         .collectMany { n -> n.tags.collect { [it, n] } }
         .groupBy { it[0] }
         .collectEntries { k, v -> [k, v*.getAt(1)] }
}

println "${new Date()} ready: ${groupByTag([new Note('a.md', ['x'])])?.size()} tags"
