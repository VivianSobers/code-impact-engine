import path from "node:path";
import { jsExtensions, languageFamily, type Language } from "../languages";
import type { RawImport } from "../extract/types";

export interface ImportSource {
  path: string;
  language: Language;
  imports: RawImport[];
}

export interface Link {
  targets: string[];
  imported: string;
}

export interface FileLinks {
  edges: Set<string>;
  bindings: Map<string, Link>;
  wildcards: string[];
  reexports: Map<string, Link>;
  starReexports: string[];
  external: Set<string>;
}

const posix = path.posix;
const scriptExtension = /\.(js|jsx|mjs|cjs)$/;

export class ImportResolver {
  private readonly paths: Set<string>;
  private readonly suffixes = new Map<string, string[]>();
  private readonly directories = new Map<string, string[]>();
  private readonly directorySuffixes = new Map<string, string[]>();

  constructor(files: ImportSource[]) {
    this.paths = new Set(files.map((file) => file.path));
    for (const file of files) {
      const segments = file.path.split("/");
      for (let start = 0; start < segments.length; start++) this.push(this.suffixes, segments.slice(start).join("/"), file.path);
      const directory = posix.dirname(file.path);
      this.push(this.directories, directory, file.path);
    }
    for (const directory of this.directories.keys()) {
      const segments = directory === "." ? [] : directory.split("/");
      for (let start = 0; start < segments.length; start++) this.push(this.directorySuffixes, segments.slice(start).join("/"), directory);
    }
  }

  private push(map: Map<string, string[]>, key: string, value: string): void {
    const list = map.get(key);
    if (!list) map.set(key, [value]);
    else if (!list.includes(value)) list.push(value);
  }

  private shortest(candidates: string[] | undefined): string | null {
    if (!candidates || candidates.length === 0) return null;
    return [...candidates].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  }

  private firstExisting(candidates: string[]): string | null {
    return candidates.find((candidate) => this.paths.has(candidate)) ?? null;
  }

  resolveJavaScript(importer: string, specifier: string): string[] {
    let bases: string[];
    if (specifier.startsWith("./") || specifier.startsWith("../") || specifier === "." || specifier === "..") {
      bases = [posix.normalize(posix.join(posix.dirname(importer), specifier))];
    } else if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
      const rest = specifier.slice(2);
      bases = [posix.normalize(rest), posix.normalize(`src/${rest}`)];
    } else {
      return [];
    }
    for (const base of bases) {
      const stem = base.replace(scriptExtension, "");
      const found = this.firstExisting([
        base,
        ...jsExtensions.map((extension) => `${base}${extension}`),
        ...(stem !== base ? jsExtensions.map((extension) => `${stem}${extension}`) : []),
        ...jsExtensions.map((extension) => `${base}/index${extension}`),
      ]);
      if (found) return [found];
    }
    return [];
  }

  resolvePython(importer: string, specifier: string): string[] {
    const dots = specifier.match(/^\.*/)?.[0].length ?? 0;
    const rest = specifier.slice(dots).replace(/\./g, "/");
    if (dots > 0) {
      let directory = posix.dirname(importer);
      for (let level = 1; level < dots; level++) directory = posix.dirname(directory);
      const base = rest ? posix.join(directory, rest) : directory;
      const found = this.firstExisting([`${base}.py`, `${base}/__init__.py`].map((candidate) => posix.normalize(candidate)));
      return found ? [found] : [];
    }
    if (!rest) return [];
    const found = this.firstExisting([`${rest}.py`, `${rest}/__init__.py`]) ??
      this.shortest(this.suffixes.get(`${rest}.py`)) ??
      this.shortest(this.suffixes.get(`${rest}/__init__.py`));
    return found ? [found] : [];
  }

  resolveJava(specifier: string): string[] {
    if (specifier.endsWith(".*")) {
      const directory = this.shortest(this.directorySuffixes.get(specifier.slice(0, -2).replace(/\./g, "/")));
      return directory ? (this.directories.get(directory) ?? []).filter((file) => file.endsWith(".java")) : [];
    }
    const parts = specifier.split(".");
    while (parts.length > 1) {
      const found = this.shortest(this.suffixes.get(`${parts.join("/")}.java`));
      if (found) return [found];
      parts.pop();
    }
    return [];
  }

  resolveGo(specifier: string): string[] {
    let best: string | null = null;
    for (const directory of this.directories.keys()) {
      if (directory === ".") continue;
      if (specifier === directory || specifier.endsWith(`/${directory}`)) {
        if (!best || directory.length > best.length) best = directory;
      }
    }
    return best ? (this.directories.get(best) ?? []).filter((file) => file.endsWith(".go")) : [];
  }

  resolve(file: ImportSource, specifier: string): string[] {
    const targets = (() => {
      switch (file.language) {
        case "javascript":
        case "typescript":
          return this.resolveJavaScript(file.path, specifier);
        case "python":
          return this.resolvePython(file.path, specifier);
        case "java":
          return this.resolveJava(specifier);
        case "go":
          return this.resolveGo(specifier);
      }
    })();
    return targets.filter((target) => target !== file.path);
  }

  link(file: ImportSource): FileLinks {
    const links: FileLinks = {
      edges: new Set(),
      bindings: new Map(),
      wildcards: [],
      reexports: new Map(),
      starReexports: [],
      external: new Set(),
    };
    for (const entry of file.imports) {
      const targets = this.resolve(file, entry.specifier);
      for (const target of targets) links.edges.add(target);

      for (const binding of entry.bindings) {
        let link: Link = { targets, imported: binding.imported };
        if (file.language === "python" && binding.imported !== "*") {
          const submodule = this.resolve(file, `${entry.specifier}${entry.specifier.endsWith(".") ? "" : "."}${binding.imported}`);
          if (submodule.length > 0) {
            for (const target of submodule) links.edges.add(target);
            link = { targets: submodule, imported: "*" };
          }
        }
        if (link.targets.length === 0) {
          if (binding.local !== "*") links.external.add(binding.local);
          continue;
        }
        if (binding.local === "*") {
          if (entry.reexport) links.starReexports.push(...targets);
          else links.wildcards.push(...targets);
          continue;
        }
        if (entry.reexport) links.reexports.set(binding.local, link);
        else links.bindings.set(binding.local, link);
      }
    }
    if (languageFamily(file.language) === "python") {
      for (const [local, link] of links.bindings) if (!links.reexports.has(local)) links.reexports.set(local, link);
      links.starReexports.push(...links.wildcards);
    }
    return links;
  }
}
