-- PostgreSQL dialect: jsonb, arrays, RETURNING, dollar quoting.
CREATE TABLE notes (
  id serial PRIMARY KEY,
  path text NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb,
  tags text[] DEFAULT ARRAY[]::text[]
);

INSERT INTO notes (path, tags) VALUES ('a.md', ARRAY['x', 'y']) RETURNING id;

CREATE FUNCTION tag_count(n notes) RETURNS int AS $$
  SELECT cardinality(n.tags);
$$ LANGUAGE sql IMMUTABLE;

SELECT path, meta->>'title' AS title FROM notes WHERE tags @> ARRAY['x'] LIMIT 10;
