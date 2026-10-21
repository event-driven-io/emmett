// Prints what the editor shows when hovering an identifier (TypeScript language service quick info).
// Usage: tsx scripts/hover.ts <file> <identifier> [occurrence]
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const [file, identifier, occurrence = '1'] = process.argv.slice(2) as [string, string, string?];
const configPath = path.resolve('tsconfig.json');
const config = ts.parseJsonConfigFileContent(
  ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, path.dirname(configPath));
const files = new Map<string, string>();
const host: ts.LanguageServiceHost = {
  getScriptFileNames: () => config.fileNames,
  getScriptVersion: () => '1',
  getScriptSnapshot: (f) => fs.existsSync(f) ? ts.ScriptSnapshot.fromString(files.get(f) ?? fs.readFileSync(f, 'utf8')) : undefined,
  getCurrentDirectory: () => process.cwd(),
  getCompilationSettings: () => config.options,
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
};
const service = ts.createLanguageService(host);
const abs = path.resolve(file);
const text = fs.readFileSync(abs, 'utf8');
let index = -1;
// "type:X" hovers the type alias declaration `type X =`
const [mode, name] = identifier.startsWith('type:') ? ['type', identifier.slice(5)] : identifier.startsWith('interface:') ? ['interface', identifier.slice(10)] : ['id', identifier];
const re = mode === 'interface' ? new RegExp(`interface ${name}\\b`, 'g') : mode === 'type' ? new RegExp(`type ${name}\\b`, 'g') : new RegExp(`\\b${name}\\b`, 'g');
for (let i = 0; i < Number(occurrence); i++) { const m = re.exec(text); if (!m) break; index = m.index + (mode === 'type' ? 5 : mode === 'interface' ? 10 : 0); }
const info = service.getQuickInfoAtPosition(abs, index);
console.log(ts.displayPartsToString(info?.displayParts));
