// Go: structs, methods, goroutines, error handling.
package main

import (
	"fmt"
	"os"
	"sync"
)

type Note struct {
	Path string
	Tags []string
}

func (n Note) Size() (int64, error) {
	info, err := os.Stat(n.Path)
	if err != nil {
		return 0, fmt.Errorf("stat %s: %w", n.Path, err)
	}
	return info.Size(), nil
}

func main() {
	notes := []Note{{"a.md", []string{"x"}}, {"b.md", nil}}
	var wg sync.WaitGroup
	for _, n := range notes {
		wg.Add(1)
		go func(n Note) {
			defer wg.Done()
			if s, err := n.Size(); err == nil {
				fmt.Printf("%s: %d bytes\n", n.Path, s)
			}
		}(n)
	}
	wg.Wait()
}
