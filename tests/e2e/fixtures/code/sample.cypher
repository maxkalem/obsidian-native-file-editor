// Cypher: MATCH, MERGE, WITH, aggregation.
MERGE (n:Note {path: 'a.md'})
ON CREATE SET n.size = 12, n.created = timestamp()
WITH n
UNWIND ['x', 'y'] AS tag
MERGE (t:Tag {name: tag})
MERGE (n)-[:TAGGED]->(t);

MATCH (n:Note)-[:TAGGED]->(t:Tag)
WHERE n.size < 5 * 1024 * 1024
RETURN t.name AS tag, count(n) AS notes
ORDER BY notes DESC LIMIT 10;
