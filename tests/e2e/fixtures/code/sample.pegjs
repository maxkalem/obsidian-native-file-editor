// PEG.js: a grammar for tag lines with actions.
{
  const LIMIT = 5 * 1024 * 1024;
}

Line
  = _ tags:(Tag _)* comment:Comment? { return { tags: tags.map(t => t[0]), comment }; }

Tag
  = "#" name:Ident { return name; }

Ident
  = [a-zA-Z_] [a-zA-Z0-9_-]* { return text(); }

Comment
  = ";" text:[^\n]* { return text.join("").trim(); }

_ "whitespace"
  = [ \t]*
