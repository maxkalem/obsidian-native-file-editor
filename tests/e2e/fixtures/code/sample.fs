// F#: records, discriminated unions, pipelines, pattern matching.
module Scanner

let limit = 5L * 1024L * 1024L

type Note = { Path: string; Tags: string list; Size: int64 }

type Mode =
    | Preview
    | Edit of force: bool

let isLarge (n: Note) = n.Size > limit

let groupByTag (notes: Note list) =
    notes
    |> List.filter (isLarge >> not)
    |> List.collect (fun n -> n.Tags |> List.map (fun t -> t, n))
    |> List.groupBy fst
    |> List.map (fun (t, ps) -> t, List.map snd ps)
    |> Map.ofList

let describe n =
    match n with
    | 0 -> "no tags"
    | n when n > 100 -> sprintf "many tags: %d" n
    | n -> sprintf "%d tags" n

printfn "%s" (describe (groupByTag [ { Path = "a.md"; Tags = [ "x" ]; Size = 12L } ] |> Map.count))
