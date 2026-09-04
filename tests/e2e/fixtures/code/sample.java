// Java: generics, streams, records.
import java.nio.file.*;
import java.util.*;
import java.util.stream.*;

public record Note(Path path, List<String> tags) {
    static final long LIMIT = 5L * 1024 * 1024;

    public long size() throws java.io.IOException {
        return Files.size(path);
    }

    public static Map<String, List<Note>> groupByTag(Collection<Note> notes) {
        return notes.stream()
            .flatMap(n -> n.tags().stream().map(t -> Map.entry(t, n)))
            .collect(Collectors.groupingBy(Map.Entry::getKey,
                     Collectors.mapping(Map.Entry::getValue, Collectors.toList())));
    }

    public static void main(String[] args) {
        System.out.printf("%d notes%n", args.length);
    }
}
