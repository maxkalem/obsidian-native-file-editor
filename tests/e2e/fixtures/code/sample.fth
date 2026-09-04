\ Forth: words, stack comments, variables, loops.
5242880 CONSTANT LIMIT
VARIABLE COUNT

: LARGE? ( size -- flag ) LIMIT > ;

: COUNT-LARGE ( addr n -- )
  0 COUNT !
  0 DO
    DUP I CELLS + @ LARGE? IF 1 COUNT +! THEN
  LOOP DROP
  COUNT @ . ." large files" CR ;

CREATE SIZES 12 , 7 , 6291456 ,
SIZES 3 COUNT-LARGE   \ prints: 1 large files
