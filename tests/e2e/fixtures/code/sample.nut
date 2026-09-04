// Squirrel: tables, classes, foreach, string formatting.
class Note {
    path = null;
    tags = null;
    constructor(p, t = []) { path = p; tags = t; }
    function describe() { return format("%s (%d tags)", path, tags.len()); }
}

local notes = [Note("a.md", ["x", "y"]), Note("b.md")];
local byTag = {};
foreach (n in notes) {
    foreach (t in n.tags) {
        if (!(t in byTag)) byTag[t] <- [];
        byTag[t].append(n);
    }
}
print(notes[0].describe() + "\n");  // a.md (2 tags)
