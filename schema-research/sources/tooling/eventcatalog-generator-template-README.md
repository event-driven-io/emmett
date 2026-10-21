# EventCatalog Generator Template

Starter project to create your own [generators](https://www.eventcatalog.dev/docs/development/plugins/generators) for EventCatalog.

## Developing your own plugin

### 1. Clone this repo

```
git clone git@github.com:event-catalog/generator-template.git
```

### 2. Install dependencies

```sh
# using pnpm
pnpm i

# using npm
npm i
```

### 3. Link the project

Link the project so it can be used in your EventCatalog.

```sh
# default package name is @eventcatalog/generator-template, this will linked
npm link
```

### 4. Using the package in your EventCatalog

Navigate to your EventCatalog directory, then link the package.

```sh
# default name, this may have changed you renamed your package
npm link @eventcatalog/generator-template
```

### 5. Configure your EventCatalog to use your generator

Edit your `eventcatalog.config.js` file and add the generator

```js
...
generators: [
    [
        "@eventcatalog/generator-template", 
        // These are options to give your generator
        {
            debug: true,
        }
    ]
]
...
```

### 6. Compile and watch your plugin

In your plugin directory run:

```sh
# Just build the plugin once
pnpm run build

# Watch changes (recommended for dev)
pnpm run build -- -- watch
```

### 7. Run your generator

In your EventCatalog directory run:

```
npm run generate
```

This will run your generator code and interact with your Catalog.

You can now add your custom code to your generator to test against your catalog.

You can use the [EventCatalog SDK](https://www.eventcatalog.dev/docs/sdk) to get utils to read, write and delete files in your Catalog easier.

---

### Contributing back to EventCatalog eco-system

Building a plugin? We would love to add it[ our integrations](https://www.eventcatalog.dev/integrations) and/or GitHub org. If this is something you are interested in you can reach out on [Discord](https://discord.gg/3rjaZMmrAm) or create an issue in this project.
