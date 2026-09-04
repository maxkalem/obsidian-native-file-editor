# Ruby (legacy stream mode): classes, blocks, symbols, interpolation.
require "pathname"

class Note
  LIMIT = 5 * 1024 * 1024
  attr_reader :path, :tags

  def initialize(path, tags = [])
    @path = Pathname(path)
    @tags = tags
  end

  def size = @path.size
  def large? = size > LIMIT
end

def group_by_tag(notes)
  notes.reject(&:large?).each_with_object(Hash.new { |h, k| h[k] = [] }) do |note, out|
    note.tags.each { |tag| out[tag] << note }
  end
end

puts "#{Time.now.iso8601} ready" if __FILE__ == $0
