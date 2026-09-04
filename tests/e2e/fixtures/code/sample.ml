(* OCaml: records, variants, pattern matching, modules. *)
let limit = 5 * 1024 * 1024

type note = { path : string; tags : string list; size : int }

type mode = Preview | Edit of bool

let is_large n = n.size > limit

let group_by_tag notes =
  let tbl = Hashtbl.create 16 in
  List.iter
    (fun n ->
      if not (is_large n) then
        List.iter (fun t -> Hashtbl.replace tbl t (n :: (try Hashtbl.find tbl t with Not_found -> []))) n.tags)
    notes;
  tbl

let describe = function
  | 0 -> "no tags"
  | n when n > 100 -> Printf.sprintf "many tags: %d" n
  | n -> Printf.sprintf "%d tags" n

let () = print_endline (describe (Hashtbl.length (group_by_tag [ { path = "a.md"; tags = [ "x" ]; size = 12 } ])))
