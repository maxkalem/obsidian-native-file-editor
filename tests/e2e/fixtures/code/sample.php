<?php
// PHP: classes, typed properties, arrays, string interpolation.
declare(strict_types=1);

namespace NativeFileEditor;

final class Note
{
    public function __construct(
        public readonly string $path,
        public readonly array $tags = [],
    ) {}

    public function size(): int
    {
        return filesize($this->path) ?: 0;
    }
}

/** @param Note[] $notes */
function groupByTag(array $notes): array
{
    $out = [];
    foreach ($notes as $note) {
        foreach ($note->tags as $tag) {
            $out[$tag][] = $note;
        }
    }
    echo "grouped " . count($out) . " tags\n";
    return $out;
}
