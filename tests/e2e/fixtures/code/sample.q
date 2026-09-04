/ q (kdb+): tables, functional selects, lambdas.
limit:5*1024*1024
notes:([] path:`a.md`b.md`c.md; size:12 6291456 7; tag:`x`y`x)

isLarge:{x>limit}
small:select from notes where not isLarge size
byTag:select notes:count i, biggest:max size by tag from small

describe:{$[x=0;"no tags";x>100;"many tags: ",string x;string[x]," tags"]}
show describe count byTag
/ output: "2 tags"
