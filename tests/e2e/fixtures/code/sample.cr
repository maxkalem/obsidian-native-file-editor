# Crystal: typed structs, macros, blocks, string interpolation.
require "file"

LIMIT = 5_i64 * 1024 * 1024

record Note, path : String, tags : Array(String) = [] of String do
  def size : Int64
    File.size(path)
  end
end

def group_by_tag(notes : Array(Note)) : Hash(String, Array(Note))
  notes.reject { |n| n.size > LIMIT }.each_with_object({} of String => Array(Note)) do |n, out|
    n.tags.each { |t| (out[t] ||= [] of Note) << n }
  end
end

puts "#{Time.utc} ready"
