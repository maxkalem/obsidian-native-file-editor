// Scala: case classes, pattern matching, for-comprehension.
package nfe

import scala.io.Source

case class Note(path: String, tags: List[String] = Nil) {
  def size: Long = Source.fromFile(path).length
}

object Scanner {
  val Limit = 5L * 1024 * 1024

  def groupByTag(notes: Seq[Note]): Map[String, Seq[Note]] =
    (for { n <- notes; t <- n.tags } yield t -> n).groupMap(_._1)(_._2)

  def describe(n: Int): String = n match {
    case 0 => "no tags"
    case x if x > 100 => s"many tags: $x"
    case x => s"$x tags"
  }
}
