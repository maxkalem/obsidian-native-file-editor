"Smalltalk: class definition, methods, blocks, collections."
Object subclass: #Note
    instanceVariableNames: 'path tags size'
    classVariableNames: 'Limit'
    package: 'NFE'.

Note class >> limit
    ^ Limit ifNil: [ Limit := 5 * 1024 * 1024 ]

Note >> isLarge
    ^ size > self class limit

Note class >> groupByTag: notes
    | out |
    out := Dictionary new.
    (notes reject: [ :n | n isLarge ]) do: [ :n |
        n tags do: [ :t | (out at: t ifAbsentPut: [ OrderedCollection new ]) add: n ] ].
    ^ out

Transcript show: 'ready'; cr.
