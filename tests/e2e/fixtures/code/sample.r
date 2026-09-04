# R: functions, vectors, data frames, apply family, pipes.
limit <- 5 * 1024 * 1024

notes <- data.frame(
  path = c("a.md", "b.md", "c.md"),
  size = c(12L, 6291456L, 7L),
  tag  = c("x", "y", "x"),
  stringsAsFactors = FALSE
)

is_large <- function(size) size > limit

small <- notes[!is_large(notes$size), ]
by_tag <- tapply(small$path, small$tag, length)

describe <- function(n) {
  if (n == 0) "no tags" else if (n > 100) sprintf("many tags: %d", n) else paste(n, "tags")
}

cat(describe(length(by_tag)), "\n")  # "1 tags"
