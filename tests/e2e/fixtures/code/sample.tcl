# Tcl: procs, lists, dicts, expr, string formatting.
set limit [expr {5 * 1024 * 1024}]

proc isLarge {size} {
    global limit
    return [expr {$size > $limit}]
}

proc groupByTag {notes} {
    set out [dict create]
    foreach n $notes {
        lassign $n path tags size
        if {[isLarge $size]} continue
        foreach t $tags { dict lappend out $t $path }
    }
    return $out
}

set g [groupByTag {{a.md {x y} 12} {b.md {y} 6291456}}]
puts [format "%d tags" [dict size $g]]  ;# 2 tags
