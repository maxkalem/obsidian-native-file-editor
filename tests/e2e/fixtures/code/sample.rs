// Rust: structs, traits, pattern matching, lifetimes.
use std::collections::HashMap;
use std::fs;

#[derive(Debug, Clone)]
pub struct Note<'a> {
    pub path: &'a str,
    pub tags: Vec<String>,
}

pub trait Sized2 {
    fn size(&self) -> u64;
}

impl<'a> Sized2 for Note<'a> {
    fn size(&self) -> u64 {
        fs::metadata(self.path).map(|m| m.len()).unwrap_or(0)
    }
}

pub fn group<'a>(notes: &[Note<'a>]) -> HashMap<String, Vec<&Note<'a>>> {
    let mut out: HashMap<String, Vec<&Note>> = HashMap::new();
    for note in notes {
        for tag in &note.tags {
            out.entry(tag.clone()).or_default().push(note);
        }
    }
    match out.len() {
        0 => println!("no tags"),
        n if n > 100 => println!("many tags: {n}"),
        n => println!("{n} tags"),
    }
    out
}
