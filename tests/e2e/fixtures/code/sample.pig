-- Pig Latin: LOAD, FILTER, GROUP, FOREACH, STORE.
%default LIMIT 5242880

notes = LOAD 'notes.tsv' USING PigStorage('\t') AS (path:chararray, tag:chararray, size:long);
small = FILTER notes BY size <= $LIMIT AND tag IS NOT NULL;
by_tag = GROUP small BY tag;
counts = FOREACH by_tag GENERATE group AS tag, COUNT(small) AS notes, MAX(small.size) AS biggest;
sorted = ORDER counts BY notes DESC;
top10 = LIMIT sorted 10;

STORE top10 INTO 'out/tags' USING PigStorage(',');
DUMP top10;
