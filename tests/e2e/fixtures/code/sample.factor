! Factor: stack effects, words, quotations, sequences.
USING: kernel sequences assocs math io formatting ;
IN: nfe.scanner

CONSTANT: limit 5242880

TUPLE: note path tags size ;
C: <note> note

: large? ( note -- ? ) size>> limit > ;

: group-by-tag ( notes -- assoc )
    [ large? not ] filter
    H{ } clone [ [ dup tags>> [ pick push-at ] with each ] each ] keep nip ;

: describe ( n -- str )
    dup 0 = [ drop "no tags" ] [ "%d tags" sprintf ] if ;

"a.md" { "x" "y" } 12 <note> 1array group-by-tag assoc-size describe print
