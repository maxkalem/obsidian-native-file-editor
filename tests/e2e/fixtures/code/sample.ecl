// ECL (HPCC): record layouts, datasets, transforms, output.
IMPORT STD;

NoteRec := RECORD
  STRING path;
  UNSIGNED4 size;
  SET OF STRING tags;
END;

notes := DATASET([{'a.md', 12, ['x', 'y']}, {'b.md', 7, []}], NoteRec);

Limit := 5 * 1024 * 1024;
small := notes(size <= Limit);

tagged := PROJECT(small, TRANSFORM(NoteRec, SELF.path := STD.Str.ToUpperCase(LEFT.path), SELF := LEFT));

OUTPUT(tagged, NAMED('SmallNotes'));
OUTPUT(COUNT(notes), NAMED('Total'));
