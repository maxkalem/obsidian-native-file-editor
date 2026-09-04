// Ceylon: classes, union types, comprehensions.
shared class Note(shared String path, shared [String*] tags = []) {
    shared Integer size => path.size * 10;
    string => "``path`` (``tags.size`` tags)";
}

shared Map<String, [Note*]> groupByTag({Note*} notes) {
    value pairs = { for (n in notes) for (t in n.tags) t -> n };
    return map { for (t -> _ in pairs) t -> [ for (u -> n in pairs) if (u == t) n ] };
}

shared void run() {
    Note|Null n = Note("a.md", ["x"]);
    if (exists n) { print(n); }
}
