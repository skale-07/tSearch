export interface TreePath {
  path: string;
  type: "blob" | "tree";
  size?: number;
}

const IGNORE_PATH =
  /(^|\/)(node_modules|vendor|dist|build|coverage|\.git|__pycache__|\.next|out|target|generated|min|bundle)(\/|$)/i;

const BINARY_EXT =
  /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|gz|tar|woff2?|ttf|eot|mp4|mp3|wasm|bin|exe|dll|so|dylib|lock)$/i;

const MANIFEST_NAMES =
  /^(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|requirements\.txt|composer\.json|Gemfile|pom\.xml|build\.gradle|CMakeLists\.txt)$/i;

const CENTRAL_NAME =
  /(scheduler|engine|model|parser|compiler|pipeline|runtime|evaluator|optimizer|service|controller|storage|graph|algorithm|core|index|main|app|lib)\./i;

const SOURCE_EXT =
  /\.(ts|tsx|js|jsx|py|rs|go|java|kt|cpp|cc|c|h|hpp|cs|rb|scala|swift|m|mm|php|lua|jl|r|sql)$/i;

const TEST_PATH = /(^|\/)(tests?|spec|__tests__)(\/|$)|[._-](test|spec)\./i;

export function shouldIgnorePath(p: string): boolean {
  if (IGNORE_PATH.test(p)) return true;
  if (BINARY_EXT.test(p)) return true;
  if (/\.min\.(js|css)$/i.test(p)) return true;
  return false;
}

export function isManifestPath(p: string): boolean {
  const base = p.split("/").pop() ?? p;
  return MANIFEST_NAMES.test(base);
}

export function selectSourceFiles(
  tree: TreePath[],
  opts?: { maxCore?: number; maxTests?: number; readmeRefs?: string[] }
): { core: string[]; tests: string[]; manifests: string[] } {
  const maxCore = opts?.maxCore ?? 8;
  const maxTests = opts?.maxTests ?? 4;
  const readmeRefs = new Set((opts?.readmeRefs ?? []).map((r) => r.toLowerCase()));

  const blobs = tree.filter(
    (t) => t.type === "blob" && !shouldIgnorePath(t.path)
  );

  const manifests = blobs
    .filter((t) => isManifestPath(t.path))
    .map((t) => t.path)
    .slice(0, 6);

  const scored = blobs
    .filter((t) => SOURCE_EXT.test(t.path) && !TEST_PATH.test(t.path))
    .map((t) => {
      let score = 0;
      const size = t.size ?? 0;
      if (size > 200 && size < 200_000) score += 2;
      if (CENTRAL_NAME.test(t.path)) score += 5;
      if (readmeRefs.has(t.path.toLowerCase())) score += 4;
      const depth = t.path.split("/").length;
      if (depth <= 3) score += 2;
      if (/\.(lock|sum)$/i.test(t.path)) score -= 10;
      return { path: t.path, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const core = scored.slice(0, maxCore).map((x) => x.path);

  const tests = blobs
    .filter((t) => TEST_PATH.test(t.path) && SOURCE_EXT.test(t.path))
    .map((t) => t.path)
    .slice(0, maxTests);

  return { core, tests, manifests };
}
