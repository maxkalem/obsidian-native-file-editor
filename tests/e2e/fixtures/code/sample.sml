(* Standard ML: datatypes, records, pattern matching, folds. *)
val limit = 5 * 1024 * 1024

type note = { path : string, tags : string list, size : int }

datatype mode = Preview | Edit of bool

fun isLarge ({ size, ... } : note) = size > limit

fun groupByTag notes =
  let
    fun add (n : note, acc) =
      foldl (fn (t, m) => (t, n) :: m) acc (#tags n)
  in
    foldl add [] (List.filter (not o isLarge) notes)
  end

fun describe 0 = "no tags"
  | describe n = if n > 100 then "many tags: " ^ Int.toString n else Int.toString n ^ " tags"

val _ = print (describe (length (groupByTag [{ path = "a.md", tags = ["x"], size = 12 }])) ^ "\n")
