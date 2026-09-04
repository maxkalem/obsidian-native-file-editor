Module: nfe-scanner
Synopsis: Dylan sample with classes, generic functions and iteration.

define constant $limit :: <integer> = 5 * 1024 * 1024;

define class <note> (<object>)
  constant slot note-path :: <string>, required-init-keyword: path:;
  constant slot note-tags :: <sequence> = #(), init-keyword: tags:;
end class;

define generic large? (n :: <note>) => (large :: <boolean>);

define method large? (n :: <note>) => (large :: <boolean>)
  n.note-path.size > $limit
end method;

define function main ()
  let n = make(<note>, path: "a.md", tags: #("x", "y"));
  format-out("%s: %d tags\n", n.note-path, n.note-tags.size);
end function;
