// Swift: structs, protocols, optionals, closures, string interpolation.
import Foundation

let limit: UInt64 = 5 * 1024 * 1024

protocol Sized {
    var size: UInt64 { get }
}

struct Note: Sized {
    let path: String
    var tags: [String] = []

    var size: UInt64 {
        (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? UInt64) ?? 0
    }
    var isLarge: Bool { size > limit }
}

func groupByTag(_ notes: [Note]) -> [String: [Note]] {
    var out: [String: [Note]] = [:]
    for n in notes where !n.isLarge {
        for t in n.tags { out[t, default: []].append(n) }
    }
    return out
}

let groups = groupByTag([Note(path: "a.md", tags: ["x", "y"])])
print("\(groups.count) tags")  // 2 tags
