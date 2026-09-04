/* SAS: data steps, procs, macros, formats. */
%let limit = 5242880;

data notes;
    infile datalines dlm=',';
    input path $ size tag $;
    large = (size > &limit);
    datalines;
a.md,12,x
b.md,6291456,y
c.md,7,x
;
run;

proc sql;
    select tag, count(*) as notes, max(size) as biggest
    from notes
    where not large
    group by tag
    order by notes desc;
quit;

proc print data=notes noobs; title "Notes"; run;
