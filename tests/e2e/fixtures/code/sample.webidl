// WebIDL: interfaces, dictionaries, enums, extended attributes.
enum ViewMode { "preview", "edit" };

dictionary NoteInit {
  required USVString path;
  sequence<DOMString> tags = [];
  unsigned long long size = 0;
};

[Exposed=Window]
interface Note {
  constructor(NoteInit init);
  readonly attribute USVString path;
  readonly attribute FrozenArray<DOMString> tags;
  attribute ViewMode mode;
  Promise<ArrayBuffer> read();
  [NewObject] Note clone(optional boolean deep = false);
  static boolean isLarge(unsigned long long size);
};

partial interface Note {
  const unsigned long long LIMIT = 5242880;
};
