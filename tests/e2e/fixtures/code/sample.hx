// Haxe: classes, typedefs, enums, string interpolation.
package nfe;

typedef Note = { path: String, tags: Array<String>, size: Int };

enum Mode { Preview; Edit(force: Bool); }

class Scanner {
    static inline var LIMIT = 5 * 1024 * 1024;

    public static function groupByTag(notes: Array<Note>): Map<String, Array<Note>> {
        final out = new Map<String, Array<Note>>();
        for (n in notes) if (n.size <= LIMIT) for (t in n.tags) {
            if (!out.exists(t)) out.set(t, []);
            out.get(t).push(n);
        }
        return out;
    }

    static function main() {
        final g = groupByTag([{ path: "a.md", tags: ["x"], size: 12 }]);
        trace('${Lambda.count(g)} tags');
    }
}
