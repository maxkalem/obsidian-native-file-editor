-- Lua (legacy stream mode): tables, closures, string methods.
local Note = {}
Note.__index = Note

function Note.new(path, tags)
  return setmetatable({ path = path, tags = tags or {} }, Note)
end

function Note:size()
  local f = io.open(self.path, "rb")
  if not f then return 0 end
  local n = f:seek("end")
  f:close()
  return n
end

local function groupByTag(notes)
  local out = {}
  for _, note in ipairs(notes) do
    for _, tag in ipairs(note.tags) do
      out[tag] = out[tag] or {}
      table.insert(out[tag], note)
    end
  end
  print(("grouped %d notes"):format(#notes))
  return out
end

return { Note = Note, groupByTag = groupByTag }
