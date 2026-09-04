-- Elm: types, records, pattern matching, pipelines.
module Scanner exposing (Note, groupByTag, describe)

import Dict exposing (Dict)


type alias Note =
    { path : String, tags : List String, size : Int }


limit : Int
limit =
    5 * 1024 * 1024


groupByTag : List Note -> Dict String (List Note)
groupByTag notes =
    notes
        |> List.filter (\n -> n.size <= limit)
        |> List.concatMap (\n -> List.map (\t -> ( t, n )) n.tags)
        |> List.foldl (\( t, n ) acc -> Dict.update t (Maybe.withDefault [] >> (::) n >> Just) acc) Dict.empty


describe : Int -> String
describe n =
    case n of
        0 -> "no tags"
        _ -> String.fromInt n ++ " tags"
