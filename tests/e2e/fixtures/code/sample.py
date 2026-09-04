"""Python: classes, decorators, f-strings, comprehensions."""
from dataclasses import dataclass, field
from pathlib import Path
import re

TAG = re.compile(r"#([\w-]+)")


@dataclass
class Note:
    path: Path
    tags: list[str] = field(default_factory=list)

    @property
    def size(self) -> int:
        return self.path.stat().st_size


def scan(root: Path) -> dict[str, list[Note]]:
    notes = [Note(p, TAG.findall(p.read_text("utf-8"))) for p in root.rglob("*.md")]
    by_tag: dict[str, list[Note]] = {}
    for note in notes:
        for tag in note.tags:
            by_tag.setdefault(tag, []).append(note)
    print(f"{len(notes)} notes, {len(by_tag)} tags")  # summary
    return by_tag


if __name__ == "__main__":
    scan(Path("."))
