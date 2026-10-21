// Prints the fully evaluated type of an exported alias.
import ts from 'typescript';
import path from 'node:path';
const [file, name] = process.argv.slice(2) as [string, string];
const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile('tsconfig.json', ts.sys.readFile).config, ts.sys, process.cwd());
const program = ts.createProgram([path.resolve(file)], cfg.options);
const checker = program.getTypeChecker();
const source = program.getSourceFile(path.resolve(file))!;
const sym = checker.getExportsOfModule(checker.getSymbolAtLocation(source)!).find((s) => s.name === name)!;
const type = checker.getDeclaredTypeOfSymbol(sym);
for (const prop of type.getProperties()) {
  console.log(prop.name, checker.typeToString(checker.getTypeOfSymbol(prop), undefined, ts.TypeFormatFlags.NoTruncation));
}
