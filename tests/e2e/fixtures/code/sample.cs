// C# (legacy stream mode): classes, LINQ, string interpolation.
using System;
using System.Collections.Generic;
using System.Linq;

namespace NativeFileEditor
{
    public record Note(string Path, IReadOnlyList<string> Tags, long Size);

    public static class Scanner
    {
        private const long Limit = 5L * 1024 * 1024;

        public static IDictionary<string, List<Note>> GroupByTag(IEnumerable<Note> notes)
        {
            var big = notes.Where(n => n.Size > Limit).Select(n => n.Path).ToHashSet();
            return notes
                .Where(n => !big.Contains(n.Path))
                .SelectMany(n => n.Tags.Select(t => (t, n)))
                .GroupBy(p => p.t, p => p.n)
                .ToDictionary(g => g.Key, g => g.ToList());
        }

        public static void Main() => Console.WriteLine($"{DateTime.Now:O} ready");
    }
}
