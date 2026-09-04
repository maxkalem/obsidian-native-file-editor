// D: structs, templates, ranges, UFCS.
import std.stdio, std.algorithm, std.array, std.file;

enum LIMIT = 5L * 1024 * 1024;

struct Note {
    string path;
    string[] tags;
    ulong size() const { return exists(path) ? getSize(path) : 0; }
}

auto groupByTag(R)(R notes) {
    Note[][string] out;
    foreach (n; notes.filter!(n => n.size <= LIMIT))
        foreach (t; n.tags) out[t] ~= n;
    return out;
}

void main() {
    auto g = [Note("a.md", ["x", "y"])].groupByTag;
    writefln("%d tags", g.length);  // 2
}
