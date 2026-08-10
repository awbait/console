// Command envexample writes the root .env.example from the Config struct.
// Run it from the repository root, or through `make env-example`.
package main

import (
	"flag"
	"fmt"
	"os"

	"console/internal/config"
)

func main() {
	out := flag.String("o", ".env.example", "file to write")
	flag.Parse()
	// LF on every platform: the file is compared byte for byte with what this
	// generator produces, and .gitattributes pins it to LF for the same reason.
	if err := os.WriteFile(*out, []byte(config.RenderEnvExample()), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "write:", err)
		os.Exit(1)
	}
	fmt.Println("wrote", *out)
}
