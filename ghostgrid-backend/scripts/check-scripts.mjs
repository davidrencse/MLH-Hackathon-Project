import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const directory of ["scripts", "examples/bots/scripts"]) {
  for (const file of await readdir(join(root, directory))) {
    if (file.endsWith(".mjs"))
      execFileSync(process.execPath, ["--check", join(root, directory, file)], { stdio: "inherit" });
  }
}
execFileSync(process.env.PYTHON ?? "python3", ["-c", `
import ast
from pathlib import Path
root = Path(${JSON.stringify(root)})
for directory in ('scripts', 'examples/bots/scripts', 'tests'):
    for path in (root / directory).glob('*.py'):
        ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
print('JavaScript and Python scripts parse successfully')
`], { stdio: "inherit" });
