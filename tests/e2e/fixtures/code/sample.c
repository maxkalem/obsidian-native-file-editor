/* C: structs, pointers, preprocessor, printf. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define LIMIT (5 * 1024 * 1024)

typedef struct {
    char *path;
    size_t size;
} note_t;

static int is_large(const note_t *n) { return n->size > LIMIT; }

int main(int argc, char **argv) {
    note_t n = { .path = argc > 1 ? argv[1] : "a.md", .size = 12u };
    printf("%s: %zu bytes%s\n", n.path, n.size, is_large(&n) ? " (large)" : "");
    return EXIT_SUCCESS;
}
