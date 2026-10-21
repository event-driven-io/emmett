// Copyright (C) Eventuous HQ OÜ. All rights reserved
// Licensed under the Apache License, Version 2.0.

using System.Collections.Immutable;
using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using static Eventuous.Shared.Generators.Constants;

namespace Eventuous.Shared.Generators;

/// <summary>
/// Generates a static initializer per assembly that registers all classes/records
/// decorated with Eventuous.EventTypeAttribute in the provided TypeMapper instance.
/// </summary>
[Generator(LanguageNames.CSharp)]
public sealed class TypeMappingsGenerator : IIncrementalGenerator {
    public void Initialize(IncrementalGeneratorInitializationContext context) {
        // Resolve the EventTypeAttribute symbol from the compilation
        var eventTypeAttributeSymbol = context.CompilationProvider
            .Select(static (c, _) => c.GetTypeByMetadataName(EventTypeAttrFqcn));

        var syntaxCandidates = context.SyntaxProvider
            .CreateSyntaxProvider(IsCandidate, Transform)
            .Where(static t => t is not null)
            .Combine(eventTypeAttributeSymbol)
            .Select(static (pair, _) => pair.Left.HasValue ? TransformWithSymbol(pair.Left.Value, pair.Right) : null)
            .Where(static t => t is not null)
            .Select(static (t, _) => t!)
            .Collect();

        // Additionally, discover [EventType] on symbols from referenced assemblies (metadata) via the Compilation model
        var symbolCandidates = eventTypeAttributeSymbol
            .Select(static (symbol, _) => (Symbol: symbol, Compilation: (Compilation?)null))
            .Combine(context.CompilationProvider)
            .Select(static (pair, _) => DiscoverFromCompilation(pair.Right, pair.Left.Symbol));

        var mergedCandidates = syntaxCandidates
            .Combine(symbolCandidates)
            .Select(static (pair, _) => pair.Left.AddRange((IEnumerable<Mapping>)pair.Right));

        var assemblyName = context.CompilationProvider.Select((c, _) => c.AssemblyName ?? "UnknownAssembly");
        var combined     = assemblyName.Combine(mergedCandidates);
        context.RegisterSourceOutput(combined, static (spc, data) => Generate(spc, data.Left, data.Right));
    }

    static bool IsCandidate(SyntaxNode node, CancellationToken _) {
        // We only care about class or record declarations that have attributes
        return node is ClassDeclarationSyntax { AttributeLists.Count: > 0 }
            or RecordDeclarationSyntax { AttributeLists.Count: > 0 };
    }

    sealed record Mapping {
        public string FullyQualifiedType { get; set; } = null!;
        public string EventTypeName      { get; set; } = null!;
    }

    readonly struct TransformInput(GeneratorSyntaxContext context, INamedTypeSymbol? symbol) {
        public GeneratorSyntaxContext Context { get; } = context;
        public INamedTypeSymbol?      Symbol  { get; } = symbol;
    }

    static TransformInput? Transform(GeneratorSyntaxContext ctx, CancellationToken _) {
        // Get the declared symbol
        if (ctx.Node is not TypeDeclarationSyntax tds) return null;

        var symbol = ctx.SemanticModel.GetDeclaredSymbol(tds);

        // Only concrete classes/records
        if (symbol?.TypeKind is not (TypeKind.Class or TypeKind.Struct)) return null;

        return new TransformInput(ctx, symbol);
    }

    static Mapping? TransformWithSymbol(TransformInput input, INamedTypeSymbol? eventTypeAttributeSymbol) {
        var symbol = input.Symbol;
        if (symbol is null) return null;

        // Look for EventTypeAttribute using symbol comparison
        var attr = GetEventTypeAttribute(symbol, eventTypeAttributeSymbol);

        if (attr is null) return null;

        // Try to get the constructor argument (event type name)
        var evtName = TryGetEventTypeName(attr, eventTypeAttributeSymbol) ?? string.Empty;

        // Use fully-qualified global:: name for the type
        var typeName = MakeGlobal(symbol.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat));

        return new() { FullyQualifiedType = typeName, EventTypeName = evtName };
    }

    static AttributeData? GetEventTypeAttribute(ISymbol symbol, INamedTypeSymbol? eventTypeAttributeSymbol) {
        // If we have the resolved symbol, use symbol comparison (refactoring-safe)
        if (eventTypeAttributeSymbol is not null) {
            foreach (var a in symbol.GetAttributes()) {
                if (SymbolEqualityComparer.Default.Equals(a.AttributeClass, eventTypeAttributeSymbol)) {
                    return a;
                }
            }
        }

        // Fallback to string-based comparison if symbol resolution failed
        // This handles cases where EventTypeAttribute is in a different assembly not yet compiled
        foreach (var a in symbol.GetAttributes()) {
            var attrClass = a.AttributeClass;
            if (attrClass == null) continue;

            var fullName = attrClass.ToDisplayString();
            if (fullName == EventTypeAttrFqcn ||
                (attrClass.Name == EventTypeAttribute && attrClass.ContainingNamespace?.ToDisplayString() == BaseNamespace)) {
                return a;
            }
        }

        return null;
    }

    static string? TryGetEventTypeName(AttributeData attr, INamedTypeSymbol? eventTypeAttributeSymbol) {
        // Prefer the first constructor argument if it is a constant string
        if (attr.ConstructorArguments.Length > 0) {
            var arg = attr.ConstructorArguments[0];

            if (arg is { Kind: TypedConstantKind.Primitive, Value: string s }) return s;
        }

        // Also check named argument "EventType"
        // Note: NamedArguments uses string keys, not symbols, so we still use string comparison here
        // However, we verify the property exists on the attribute type when we have the symbol
        if (eventTypeAttributeSymbol is not null) {
            var hasProperty = eventTypeAttributeSymbol.GetMembers(EventTypeAttribute)
                .OfType<IPropertySymbol>()
                .Any();

            if (hasProperty) {
                foreach (var kv in attr.NamedArguments) {
                    if (kv is { Key: EventTypeAttribute, Value.Value: string s }) {
                        return s;
                    }
                }
            }
        }

        // Fallback to string-based comparison when symbol is not available
        foreach (var kv in attr.NamedArguments) {
            if (kv is { Key: EventTypeAttribute, Value.Value: string s }) return s;
        }

        return null;
    }

    static ImmutableArray<Mapping> DiscoverFromCompilation(Compilation compilation, INamedTypeSymbol? eventTypeAttributeSymbol) {
        var builder = ImmutableArray.CreateBuilder<Mapping>();

        // Current assembly
        ProcessNamespace(compilation.Assembly.GlobalNamespace);

        // Referenced assemblies
        foreach (var ra in compilation.SourceModule.ReferencedAssemblySymbols) {
            ProcessNamespace(ra.GlobalNamespace);
        }

        return builder.ToImmutable();

        void ProcessType(INamedTypeSymbol type) {
            var attr = GetEventTypeAttribute(type, eventTypeAttributeSymbol);

            if (attr is not null) {
                var evtName  = TryGetEventTypeName(attr, eventTypeAttributeSymbol) ?? string.Empty;
                var typeName = MakeGlobal(type.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat));
                builder.Add(new() { FullyQualifiedType = typeName, EventTypeName = evtName });
            }

            foreach (var nt in type.GetTypeMembers()) {
                ProcessType(nt);
            }
        }

        void ProcessNamespace(INamespaceSymbol ns) {
            foreach (var member in ns.GetMembers()) {
                switch (member) {
                    case INamespaceSymbol cns:
                        ProcessNamespace(cns); break;
                    case INamedTypeSymbol type:
                        ProcessType(type); break;
                }
            }
        }
    }

    static void Generate(SourceProductionContext context, string assemblyName, ImmutableArray<Mapping> mappings) {
        var distinct = mappings.Distinct().ToArray();

        // Always emit a file so the generator is visible to users
        if (distinct.Length == 0) {
            const string marker = "// <auto-generated> TypeMappingsGenerator found no [EventType] usages. </auto-generated>\n";
            context.AddSource("TypeMappings.Info.g.cs", marker);

            return;
        }

        var safeAssembly = SanitizeIdentifier(assemblyName);
        var className    = $"TypeMappings_{safeAssembly}";

        var sb = new StringBuilder();
        sb.AppendLine("// <auto-generated/>");
        sb.AppendLine("#nullable enable");
        sb.AppendLine("using System.Runtime.CompilerServices;");
        sb.AppendLine("using Eventuous;");
        sb.AppendLine();
        sb.AppendLine("namespace Eventuous;");
        sb.AppendLine();
        sb.AppendLine($"internal static class {className} {{");
        sb.AppendLine("    [ModuleInitializer]");
        sb.AppendLine("    internal static void Initialize() => RegisterDiscoveredTypes(TypeMap.Instance);");
        sb.AppendLine();
        sb.AppendLine("    /// <summary>");
        sb.AppendLine("    /// Registers all [EventType] types discovered at compile time into the provided mapper.");
        sb.AppendLine("    /// </summary>");
        sb.AppendLine("    public static void RegisterDiscoveredTypes(this TypeMapper mapper) {");

        foreach (var m in distinct) {
            // Prefer passing the explicit name when we have it, so runtime reflection is avoided
            sb.AppendLine(
                !string.IsNullOrEmpty(m.EventTypeName)
                    ? $"        mapper.AddType(typeof({m.FullyQualifiedType}), \"{EscapeString(m.EventTypeName)}\");"
                    : $"        mapper.AddType(typeof({m.FullyQualifiedType}));"
            );
        }

        sb.AppendLine("    }");
        sb.AppendLine("}");

        context.AddSource($"{className}.g.cs", sb.ToString());
    }

    static string EscapeString(string s) => s.Replace("\\", @"\\").Replace("\"", "\\\"");

    static string SanitizeIdentifier(string name) {
        // Replace characters that cannot appear in identifiers
        var sb = new StringBuilder(name.Length);

        foreach (var ch in name) {
            if (ch is '.' or '-' or '+') sb.Append('_');
            else if (SyntaxFacts.IsIdentifierPartCharacter(ch)) sb.Append(ch);
            else sb.Append('_');
        }

        // Ensure it doesn't start with a digit
        if (sb.Length == 0 || !SyntaxFacts.IsIdentifierStartCharacter(sb[0])) sb.Insert(0, '_');

        return sb.ToString();
    }

    static string MakeGlobal(string typeName) => !typeName.StartsWith("global::") ? $"global::{typeName}" : typeName;
}
