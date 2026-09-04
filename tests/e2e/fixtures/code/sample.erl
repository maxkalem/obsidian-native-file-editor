%% Erlang: modules, records, pattern matching, list comprehensions.
-module(scanner).
-export([group_by_tag/1, describe/1]).

-define(LIMIT, 5 * 1024 * 1024).
-record(note, {path, tags = [], size = 0}).

group_by_tag(Notes) ->
    Pairs = [{T, N} || N = #note{tags = Tags, size = S} <- Notes, S =< ?LIMIT, T <- Tags],
    lists:foldl(fun({T, N}, Acc) -> maps:update_with(T, fun(L) -> [N | L] end, [N], Acc) end,
                #{}, Pairs).

describe(0) -> "no tags";
describe(N) when N > 100 -> io_lib:format("many tags: ~p", [N]);
describe(N) -> io_lib:format("~p tags", [N]).
