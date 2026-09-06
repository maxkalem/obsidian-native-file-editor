% Visual Prolog
implement main
    open core
clauses
    run() :- console::init(), stdio::write("Hello"), succeed().
end implement main
goal
    main::run().
