# LiveScript: functions, pipes, pattern matching, comprehensions.
require! fs

LIMIT = 5 * 1024 * 1024

class Note
  (@path, @tags = []) ->
  size: -> fs.stat-sync @path .size
  large: -> @size! > LIMIT

group-by-tag = (notes) ->
  out = {}
  for n in notes when not n.large!
    for t in n.tags
      out[t] ?= []
      out[t]push n
  out

describe = (n) -> | n is 0 => "no tags"
                  | n > 100 => "many tags: #{n}"
                  | otherwise => "#{n} tags"

console.log describe Object.keys(group-by-tag [new Note \a.md, <[x y]>]).length
