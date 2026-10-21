// Prints the type TypeScript computes for a given exported type alias (what hovering shows).
import ts from 'typescript';
const [file, ...names] = process.argv.slice(2);
const program = ts.createProgram([file!], {
  strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
});
const checker = program.getTypeChecker();
const source = program.getSourceFile(file!)!;
const moduleSymbol = checker.getSymbolAtLocation(source)!;
for (const exp of checker.getExportsOfModule(moduleSymbol)) {
  if (names.length && !names.includes(exp.name)) continue;
  const decl = exp.declarations?.find((d) => ts.isTypeAliasDeclaration(d)) as ts.TypeAliasDeclaration | undefined;
  if (!decl) continue;
  const type = checker.getTypeAtLocation(decl.name);
  console.log(`${exp.name}:\n  ${checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation)}`);
}
