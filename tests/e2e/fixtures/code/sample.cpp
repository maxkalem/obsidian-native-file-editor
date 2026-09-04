// C++: templates, STL, preprocessor, lambdas.
#include <iostream>
#include <map>
#include <string>
#include <vector>

#define NFE_LIMIT (5 * 1024 * 1024)

struct Note {
    std::string path;
    std::vector<std::string> tags;
    std::size_t size = 0;
};

template <typename It>
std::map<std::string, std::vector<const Note*>> groupByTag(It begin, It end) {
    std::map<std::string, std::vector<const Note*>> out;
    for (auto it = begin; it != end; ++it) {
        if (it->size > NFE_LIMIT) continue;  // skip large files
        for (const auto& tag : it->tags) out[tag].push_back(&*it);
    }
    return out;
}

int main() {
    std::vector<Note> notes{{"a.md", {"x", "y"}, 12}, {"b.md", {}, 7}};
    auto groups = groupByTag(notes.begin(), notes.end());
    std::cout << groups.size() << " tags\n";
    return 0;
}
