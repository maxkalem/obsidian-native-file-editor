// Dart: classes, null safety, async, string interpolation.
import 'dart:io';

class Note {
  final String path;
  final List<String> tags;
  const Note(this.path, [this.tags = const []]);

  Future<int> size() async => (await File(path).stat()).size;
}

Map<String, List<Note>> groupByTag(Iterable<Note> notes) {
  final out = <String, List<Note>>{};
  for (final n in notes) {
    for (final t in n.tags) {
      (out[t] ??= []).add(n);
    }
  }
  return out;
}

void main() async {
  final n = Note('a.md', ['x']);
  print('${n.path}: ${await n.size()} bytes');
}
