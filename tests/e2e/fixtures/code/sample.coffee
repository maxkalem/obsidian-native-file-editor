# CoffeeScript: classes, comprehensions, string interpolation.
fs = require 'fs'

class Note
  LIMIT: 5 * 1024 * 1024
  constructor: (@path, @tags = []) ->
  size: -> fs.statSync(@path).size
  large: -> @size() > @LIMIT

groupByTag = (notes) ->
  out = {}
  for n in notes when not n.large()
    (out[t] ?= []).push n for t in n.tags
  out

console.log "#{Object.keys(groupByTag [new Note 'a.md', ['x']]).length} tags"
