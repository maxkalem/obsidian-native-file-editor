% MMIXAL
Main    SETL    $0,3
        CMP     $1,$0,2
        BNP     $1,Done
        TRAP    0,Fputs,StdOut
Done    TRAP    0,Halt,0
