# Julia: structs, multiple dispatch, comprehensions, broadcasting.
module Scanner

const LIMIT = 5 * 1024 * 1024

struct Note
    path::String
    tags::Vector{String}
    size::Int
end

Note(path; tags=String[]) = Note(path, tags, filesize(path))

islarge(n::Note) = n.size > LIMIT

function groupbytag(notes::AbstractVector{Note})
    out = Dict{String,Vector{Note}}()
    for n in notes, t in n.tags
        islarge(n) && continue
        push!(get!(out, t, Note[]), n)
    end
    out
end

describe(n::Integer) = n == 0 ? "no tags" : "$(n) tags"

end # module
