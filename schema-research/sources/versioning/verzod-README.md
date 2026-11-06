<div align="center">

# verzod

</div>

A simple versioning and migration library based on Zod schemas.

## Concept
*Verzod* allows you to define an 'entity' that can have multiple versions. Each version is defined by a Zod schema. You can then use the library to check if a given data matches the schema of the entity, and if not, migrate it to the latest version and use it.

## Installation
- Install the NPM package
  ```bash
  $ npm install verzod
  ```

## Usage
- Create a versioned *entity* that you want to use
  ```ts
  import { createVersionedEntity, InferredEntity } from "verzod"
  import { z } from "zod"

  const Environment_V1 = z.object({
    name: z.string(),
    v: z.literal(1),
    variables: z.array(
      z.object({
        key: z.string(),
        value: z.string(),
        masked: z.boolean()
      })
    )
  })

  const Environment_V2 = z.object({
    name: z.string(),
    v: z.literal(2),
    variables: z.array(
      z.union([
        z.object({
          name: z.string(),
          value: z.string(),
          masked: z.literal(false)
        }),
        z.object({
          name: z.string(),
          masked: z.literal(true)
        })
      ])
    )
  })

  const Environment = createVersionedEntity({
    latestVersion: 2,
    versionMap: {
      1: defineVersion({
        initial: true,
        schema: Environment_V1
      }),
      2: defineVersion({
        initial: false,
        schema: Environment_V2,
        up(old: z.infer<typeof Environment_V1>) {
          return <z.infer<typeof Environment_V2>>{
            ...old,
            v: 2,
            variables: old.variables.map(v => ({
              ...v,
              masked: false
            }))
          }
        }
      })
    },
    getVersion(data: unknown) {
      return typeof data === "object"
        && data !== null
        && "v" in data 
        && typeof data["v"] === "number" 
          ? data["v"] 
          : null 
    }
  })
  ```

- You can use the various library functionality demoed below.
  ```ts
  import { InferredEntity } from "verzod"
  
  // Get the type of the entity (will resolve to the type of the latest version schema)
  type Environment = InferredEntity<typeof Environment>


  // You can use `is` method to check if the data given matches the schema
  const v2_data = { 
    name: "test", 
    v: 2, 
    variables: [{ key: "hello", masked: true }]
  }

  Environment.is(v2_data) // Returns true

  const v1_data = { name: "test", v: 1, variables: [{ key: "hello", value: "there" }]}
  Environment.is(v1_data) // Returns true (it returns true for old versions)
  
  const invalid_ver_data = { name: "test", v: 3, variables: [] }
  Environment.is(invalid_ver_data) // false (invalid version)

  const invalid_schema_data = { name: "test", v: 2, vars: [] }
  Environment.is(invalid_schema_data) // false (invalid schema)

  // NOTE: There is also `isLatest` to check only for the latest version
  // This also narrows the type to only the latest version unlike `is` which
  // narrows to all given versions
  Environment.isLatest(v2_data) // true

  Environment.isLatest(v1_data) // false
  
  // You can use `safeParse` method to parse (and if needed, migrate) the data
  Environment.safeParse(v2_data) // { type: "ok", value: v2_data }
  Environment.safeParse(v1_data) // { type: "ok", value: { name: "test", v: 2, variables: [{ name: "hello", value: "there", masked: false }]}} <- Migrated old schema

  Environment.safeParse(invalid_ver_data) // { type: "err", error: { type: "INVALID_VER", version: 3 } <- invalid version

  Environment.safeParse(invalid_schema_data) // { type: "err", error: { type: "GIVEN_VER_VALIDATION_FAIL", version: 2, versionDef: <relevant version map entry> } } <- correct version, but invalid data

  // You can access the latest schema directly
  const latestSchema = Environment.latestSchema // Returns the z.object() schema for version 2

  ```
### Referring to entities in a Zod schema
You can refer to entities from a Zod schema using the `entityReference` method. This method takes in the entity you want to refer to and gives a custom Zod schema implementation. This schema implementation will validate the data against the entity's schema across the different versions and return the data (after migrations to the latest version if needed) if it is valid. Since, this is applicable to Zod schemas directly, this is also useful if you have a Verzod Versioned Entity, and you want to refer to other entities from it.
  
  ```ts
  import { entityReference } from "verzod"

  const SyncedEnvironment = z.object({
    id: z.string(),
    environment: entityReference(Environment) // from the above example
  })

  const synced_env_data = {
    id: "test",
    environment: {
      name: "test",
      v: 1,
      variables: [{ key: "hello", value: "there" }]
    }
  }

  SyncedEnvironment.safeParse(synced_env_data) // { type: "ok", value: { id: "test", environment: { name: "test", v: 2, variables: [{ name: "hello", value: "there", masked: false }] } } } <- migrated to latest version
  ```

### Version-Bounded Parsing and Migration

Sometimes you need to parse and migrate data only up to a specific version, not all the way to the latest. This is particularly useful for recursive entity definitions where entities reference themselves. The `upTo` series of functions provide this capability.

#### Why Version-Bounded Migration?

Consider a recursive tree structure where nodes can contain child nodes. When migrating from v1 to v2, if you use regular `entityReference`, the children might be migrated to a future version (e.g., v3 or v4) that didn't exist when you wrote the v1→v2 migration. This can break your migration logic.

Version-bounded functions ensure that entities are only migrated up to a specific version, maintaining consistency in your migration functions.

#### Available Functions

- **`isUpToVersion(data, version)`** - Type guard that checks if data is valid for any version up to and including the specified version
- **`safeParseUpToVersion(data, version)`** - Parses and migrates data up to a specific version (not beyond)
- **`entityRefUptoVersion(entity, version)`** - Creates a Zod schema for version-bounded entity references

#### Example: Recursive Tree Structure

```ts
import { createVersionedEntity, defineVersion, entityRefUptoVersion } from "verzod"
import { z } from "zod"

// Define a tree structure that references itself
const TreeNode = createVersionedEntity({
  latestVersion: 3,
  versionMap: {
    1: defineVersion({
      initial: true,
      schema: z.object({
        v: z.literal(1),
        name: z.string(),
        children: z.array(z.lazy(() => entityRefUptoVersion(TreeNode, 1)))
      })
    }),
    2: defineVersion({
      initial: false,
      schema: z.object({
        v: z.literal(2),
        name: z.string(),
        depth: z.number(),
        children: z.array(z.lazy(() => entityRefUptoVersion(TreeNode, 2)))
      }),
      up(old) {
        // When migrating v1→v2, children are guaranteed to be at v2 or lower
        // They won't be v3 even if v3 exists in the codebase
        return {
          v: 2,
          name: old.name,
          depth: 0,
          children: old.children.map(child => {
            // Manually migrate each child to v2
            const result = TreeNode.safeParseUpToVersion(child, 2)
            if (result.type !== "ok") throw new Error("Failed to migrate child")
            return result.value
          })
        }
      }
    }),
    3: defineVersion({
      initial: false,
      schema: z.object({
        v: z.literal(3),
        name: z.string(),
        depth: z.number(),
        path: z.string(),
        children: z.array(z.lazy(() => entityRefUptoVersion(TreeNode, 3)))
      }),
      up(old) {
        // Similarly, when migrating v2→v3, children are at v3 or lower
        return {
          v: 3,
          name: old.name,
          depth: old.depth,
          path: `/${old.name}`,
          children: old.children.map(child => {
            const result = TreeNode.safeParseUpToVersion(child, 3)
            if (result.type !== "ok") throw new Error("Failed to migrate child")
            return result.value
          })
        }
      }
    })
  },
  getVersion(data) {
    return (data as any)?.v ?? null
  }
})
```

#### Using Version-Bounded Functions

```ts
const v1Tree = {
  v: 1,
  name: "root",
  children: [
    { v: 1, name: "child1", children: [] },
    { v: 1, name: "child2", children: [] }
  ]
}

// Check if data is valid up to v2 (returns false for v3 data)
TreeNode.isUpToVersion(v1Tree, 2) // true
TreeNode.isUpToVersion(v3Tree, 2) // false

// Parse and migrate only up to v2
const v2Result = TreeNode.safeParseUpToVersion(v1Tree, 2)
// Result: tree migrated to v2, not v3

// Use in other schemas
const TreeContainer = z.object({
  id: z.string(),
  // This ensures the tree is at most v2
  tree: entityRefUptoVersion(TreeNode, 2)
})
```

#### Type Safety

The version-bounded functions maintain full type safety:

```ts
import { InferredEntityUpToVersion, KnownEntityVersion } from "verzod"

// Get the type at a specific version
type TreeV2 = InferredEntityUpToVersion<typeof TreeNode, 2>

// Get all valid version numbers
type TreeVersions = KnownEntityVersion<typeof TreeNode> // 1 | 2 | 3
```


<br />
<br />
<p align="center"><b>made with ❤️ by <a href="https://github.com/AndrewBastin">andrew bastin</a></b></p>