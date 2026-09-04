⍝ APL: arrays, primitives, dfns, reductions.
limit←5×1024×1024
sizes←12 6291456 7 1048576
tags←'x' 'y' 'x' 'z'

large←{⍵>limit}          ⍝ boolean mask of large sizes
nlarge←+/large sizes
small←(~large sizes)/tags
counts←{⍺,≢⍵}⌸small       ⍝ tag with its count

describe←{⍵=0:'no tags' ⋄ ⍵>100:'many tags: ',⍕⍵ ⋄ (⍕⍵),' tags'}
describe ≢∪small
