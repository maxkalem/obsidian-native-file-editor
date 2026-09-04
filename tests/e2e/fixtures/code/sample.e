note class NOTE
    -- Eiffel: classes, contracts, features.
create
    make

feature {NONE} -- Initialization
    make (a_path: STRING)
        require
            path_not_empty: not a_path.is_empty
        do
            path := a_path
            create tags.make (0)
        ensure
            path_set: path = a_path
        end

feature -- Access
    path: STRING
    tags: ARRAYED_LIST [STRING]
    limit: INTEGER = 5242880

    is_large (a_size: INTEGER): BOOLEAN
        do
            Result := a_size > limit
        end
end
