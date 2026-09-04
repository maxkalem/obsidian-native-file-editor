-- SQL: DDL, joins, aggregates, CTE.
CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  size INTEGER DEFAULT 0,
  modified TIMESTAMP
);

WITH big AS (
  SELECT id, path FROM notes WHERE size > 5 * 1024 * 1024
)
SELECT n.path, COUNT(t.tag) AS tags
FROM notes n
LEFT JOIN note_tags t ON t.note_id = n.id
WHERE n.id NOT IN (SELECT id FROM big)
GROUP BY n.path
HAVING COUNT(t.tag) >= 2
ORDER BY tags DESC
LIMIT 10;
