# typebox #1154: Standard Schema
Source: https://github.com/sinclairzx81/typebox/issues/1154 (state closed)

In case you haven't seen this yet, @sinclairzx81, TypeBox should be in the list (at the top) 😄 .
 
https://standardschema.dev/

## Comment by sinclairzx81 at 2025-02-05T08:56:11Z

@crobinson42 Hi! This was actually discussed over at https://github.com/sinclairzx81/typebox/discussions/1152. 

Unfortunately, due to several issues regarding the design of Standard Schema, I won’t be supporting it in TypeBox as a default, but do intend to provide indirect support via an adapter. I've actually added the TypeBox adapter (TypeMap) to the supported library list, it is currently listed as the 5th library implementation on the Standard Schema website.

TypeMap: https://github.com/sinclairzx81/typemap

![Image](https://github.com/user-attachments/assets/8108162a-86f2-4de6-9405-86491620442a)

---

### Usage 1

Compile TypeBox schematics into a Validator that implements the Standard Schema interface ([Example](https://www.typescriptlang.org/play/?moduleResolution=99&module=199&ts=5.8.0-beta#code/JYWwDg9gTgLgBAbzgYQuYAbApnAvnAMyjTgHIABAZ2ADsBjDAQ2CgHoYBPMLERsUgFChIsRHAAqXHPiIkK1ekxbspAIwgAPQQLoQaleADdGGYABNGMaHAC8KNGExYAFJO4A6APKqAVljowzkhwrKz26NiUcADKMIw0FlBmMXQAFjyMcABqJuaW0AJwcBoAXBJS7gByAK4gqlhQzgCUADSFcBxlblhVtfWNre0AXl0VNXUNzW24TU0COnoGcFBYlNUY8HbGphZWUADapAB+BvGJZqQAuu7beTAupO5PpE0hYbFnjEkp6bxwtPcoARGHQekA))

```typescript
const validator = Compile(Type.Object({  // Compile into Standard Schema Validator
  x: Type.Number(),
  y: Type.Number(),
  z: Type.Number(),
}))

const result = validator['~standard'].validate('...') // Standard Schema interface.
```

---

### Usage 2

Compile syntax for use in Standard Schema (i.e tRPC) supported infrastructure ([Example](https://www.typescriptlang.org/play/?moduleResolution=99&module=199&ts=5.8.0-beta#code/JYWwDg9gTgLgBAbzgYQuYAbApnAvnAMyjTgHIABAZ2ADsBjDAQ2CgHoYBPMLERsUgFChIsRHFrAYAFQBKABWR5CxEGXIwoYOq0pYoANz2k4cVqzidulAFxwaWAB4wBAs3AC0nr95++--gMCg-1dzAGU9QyhQj2C4+ITErwE6CBpKeHgAXnEaSVkFADo6KCxGGCwACgBKFLSMuGIAVwqoOByYQubWyoQBEwATCBhbTrBiOiwBptL+kzhC2jAWytR0bEqAAyQ5+bhGWyQHWxomkAAjPQAaOA4Ts8uoG4Ave4u9PCvd+fPDuGO7A9rrc3o8XqCPrhvrhNtVantChAWssYKs0GBMFVSKd3lBSHDvoUAI5NPQcSq9XIovDVdoAPkQ3xMpRgMxocEqTPmSxahUYhQccAAVFTeecBXAANRwLkmHmdfkcYWizripXS2UqvmFZ7K+WFcXPLnw+a4apfM0uARAA))

```typescript
const router = t.router({
  dot: t.procedure
    .input(Compile(`{ 
      a: { x: number, y: number, z: number },
      b: { x: number, y: number, z: number }
    }`))
    .output(Compile('number'))
    .query(({ input }) => {
      return (
        input.a.x * input.b.x + 
        input.a.y * input.b.y + 
        input.a.z * input.b.z
      )
    }),
})
```

---

### Usage 3

Support for advanced cross library translation ([Example](https://www.typescriptlang.org/play/?moduleResolution=99&module=199&ts=5.8.0-beta#code/JYWwDg9gTgLgBAbzgFQJ5gKYCEIA8A0cAyqgHYwCGucAvnAGZQQhwDkAAgM7CkDGANhWBQA9DHQYQFMKwBQoSLDgAqOBU5wAXgyYtWmiABM5s3hFKd4ALTgBeLQDoIAIwBWGXjAAUSOH7giIo5WRgDybh4wADwIsn64AFyOpACuIM4YUF4AlIT++QFB8UmaDiGGAHJpGVAA3HFwqCUOqemZOXkFfoH+TcFGVW11DZrNrTU5Xfk9fqP9ldWZ9TTZU2trPTSEDjsAfLKm5pbEdsRklLheVqsFPWYW8ERJAERIiXDjmYR9n1CEc79aM8DvdjshTmhMDhLkQbv47kd4Mgkshwu5PDEGutsdMiu9kIMavUcSTukU+gTFsNSSSZnNKUNiTTsZt9gcgA))

```typescript
const Z = z.object({     // z.ZodObject<{
  x: z.number(),         //   x: z.ZodNumber;
  y: z.number(),         //   y: z.ZodNumber;
  z: z.number()          //   z: z.ZodNumber;
})                       // }, ...>

const S = Syntax(Z)      // const S: "{ x: number, y: number, z: number }"

const T = TypeBox(S)     // const T: TObject<{
                         //  x: TNumber;
                         //  y: TNumber;
                         //  z: TNumber;
                         // }>
```

---


Hope this helps!
S



## Comment by MatthewAry at 2025-02-06T05:46:06Z

Would love to see info like this in the docs.

## Comment by marijn at 2026-08-28T09:27:12Z

@sinclairzx81 first things first: thanks for Typebox, you have build something really interesting here 

!["Hat tip animated picture"](https://c.tenor.com/Sk_-EnwPPrgAAAAC/tenor.gif)

It seems typemap has since been put on ice, is there a recommended path for standard schema compatibility? 

## Comment by sinclairzx81 at 2026-08-28T11:19:03Z

@marijn Hi, thanks :)

---

### TypeMap

TypeMap was deprecated earlier this year as it was too much work keeping up with remote validation libraries changing their schematics with every release. Moving forward, TypeBox is focusing exclusively on JSON Schema specification mapping only, but the TypeMap project is archived and public if someone wants to fork it!

---

### Standard Schema

You can find an adapter at the link below, but you will need to copy and paste it into a project.

https://github.com/sinclairzx81/typebox/tree/main/example/standard

TypeBox still doesn't support Standard Schema natively, and probably wont because it considers JSON Schema to be the only viable canonical representation for runtime types. However the adapter should solve pretty much all integration requirements (it's actually quite advanced for a relatively small module)

---

### TypeDriver

If you're interested, the following project is the spiritual successor to TypeMap

https://github.com/sinclairzx81/typedriver

---

Hope this helps!
S

