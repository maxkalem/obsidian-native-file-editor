#!/usr/bin/perl
# Perl: hashes, regexes, subs, heredoc.
use strict;
use warnings;

my $LIMIT = 5 * 1024 * 1024;

sub group_by_tag {
    my (@notes) = @_;
    my %out;
    for my $n (grep { $_->{size} <= $LIMIT } @notes) {
        push @{ $out{$_} }, $n for @{ $n->{tags} };
    }
    return \%out;
}

my $text = "notes with #x and #y-tags";
my @tags = $text =~ /#([\w-]+)/g;
my $groups = group_by_tag({ path => 'a.md', tags => \@tags, size => 12 });
printf "%d tags\n", scalar keys %$groups;
print <<"END";
done at @{[ scalar localtime ]}
END
