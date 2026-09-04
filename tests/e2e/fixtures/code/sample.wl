(* Mathematica / Wolfram Language: functions, patterns, associations. *)
limit = 5 * 1024 * 1024;

note[path_String, tags_List : {}, size_Integer : 0] := <|"path" -> path, "tags" -> tags, "size" -> size|>

large[n_Association] := n["size"] > limit

groupByTag[notes_List] := GroupBy[
  Flatten[Table[{t, n}, {n, Select[notes, ! large[#] &]}, {t, n["tags"]}], 1],
  First -> Last]

describe[0] := "no tags"
describe[n_Integer /; n > 100] := StringForm["many tags: ``", n]
describe[n_Integer] := StringForm["`` tags", n]

Print[describe[Length[groupByTag[{note["a.md", {"x", "y"}, 12]}]]]]
