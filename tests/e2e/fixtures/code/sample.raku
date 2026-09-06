# Raku
my @notes = <a b c>;
for @notes -> $n {
    say "note: $n" if $n ne 'b';
}
