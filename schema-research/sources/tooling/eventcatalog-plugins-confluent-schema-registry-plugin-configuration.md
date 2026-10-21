Copy as Markdown[View as Markdown](/docs/plugins/confluent-schema-registry/plugin-configuration.md)

***

# Plugin Configuration

## Overview[​](#overview "Direct link to Overview")

The EventCatalog Confluent Schema Registry plugin is configured in the `eventcatalog.config.js` file inside the `generators` array.

API Keys

If you are using Confluent Cloud, you need to export your API keys as environment variables in the `.env` file.

Example .env file

```
export CONFLUENT_SCHEMA_REGISTRY_KEY=your-confluent-schema-registry-key
export CONFLUENT_SCHEMA_REGISTRY_SECRET=your-confluent-schema-registry-key-secret
```

## Required Configuration Options[​](#required-configuration-options "Direct link to Required Configuration Options")

| Option               | Type      | Required | Description                                                                                                                                                                 |
| -------------------- | --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaRegistryUrl`  | `string`  | Yes      | The URL of your Confluent Schema Registry. You can find this in the Confluent Cloud dashboard. If you are running locally you can use the `http://localhost:8081` endpoint. |
| `includeAllVersions` | `boolean` | No       | If true, all versions of the schemas will be imported into EventCatalog (default is `false`).                                                                               |

## Optional Configuration Options[​](#optional-configuration-options "Direct link to Optional Configuration Options")

### Services[​](#services "Direct link to Services")

You can assign the schemas to a producer or consumer (service).

| Option               | Type                                   | Default | Description                                                                                                                                              |
| -------------------- | -------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services`           | object                                 | -       | List of producers/consumers (services) to assign the schemas to.                                                                                         |
| `services.id`        | string                                 | -       | EventCatalog ID for the service.                                                                                                                         |
| `services.sends`     | Filter                                 | -       | Configuration to assign schemas to a producer. The schemas and topic defined here will be assigned to the producer.                                      |
| `services.receives`  | Filter                                 | -       | Configuration to assign schemas to a consumer. The schemas and topic defined here will be assigned to the consumer.                                      |
| `services.writesTo`  | array\[{id: string, version?: string}] | No      | Array of [data stores](/docs/development/guides/resources/data/introduction.md) id and version (optional) that the service writes to. (Added in v0.2.1)  |
| `services.readsFrom` | array\[{id: string, version?: string}] | No      | Array of [data stores](/docs/development/guides/resources/data/introduction.md) id and version (optional) that the service reads from. (Added in v0.2.1) |

### Topics[​](#topics "Direct link to Topics")

You can document the topics for your schemas. These are channels in EventCatalog. Schemas are mapped to their topics.

| Option           | Type   | Default | Description                                                                                                                                                                                     |
| ---------------- | ------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `topics`         | object | -       | Optional list of topics to assign the schemas to. (optional). [These are documented as channels](/docs/development/guides/resources/messages/message-channels/introduction.md) in EventCatalog. |
| `topics.id`      | string | -       | EventCatalog ID for the topic (e.g `orders-topic`).                                                                                                                                             |
| `topics.name`    | string | -       | Name of the topic (e.g `Orders Topic`).                                                                                                                                                         |
| `topics.address` | string | -       | Address of the topic (e.g `kafka-cluster-1.us-east-1.confluent.cloud:9092`).                                                                                                                    |

### Domains[​](#domains "Direct link to Domains")

You can define and assign domains to your services.

| Option           | Type   | Default | Description                                           |
| ---------------- | ------ | ------- | ----------------------------------------------------- |
| `domain.id`      | string | -       | EventCatalog ID for the domain (e.g `orders-domain`). |
| `domain.name`    | string | -       | Name of the domain (e.g `Orders Domain`).             |
| `domain.version` | string | -       | Version of the domain (e.g `1.0.0`).                  |

### Filtering schemas to producers and consumers[​](#filtering-schemas-to-producers-and-consumers "Direct link to Filtering schemas to producers and consumers")

When you assign schemas to a producer or consumer (service), you can use a range of filtering options including:(suffixes, prefixes, includes or exact matches).

Here are some examples of how to filter schemas to producers and consumers.

`exact` matching example - Match schemas that exactly match the specified name

**What is exact matching?**

Exact matching is when the schema name exactly matches the specified name.

In this example, the `Orders Service` will send `events` with the schema name `order-placed`, `order-cancelled` and receive `commands` with the schema name `place-order`.

Example schemas (subjects) in Confluent Schema Registry:

* `order-placed-value`
* `order-cancelled-value`
* `place-order-value`
* `cancel-order-value`

*Note: EventCatalog matches the `subject` of the schema in the registry. The `subject` in the registry has a suffix of `-value`. This is automatically removed when the schema is assigned to a producer or consumer. So you need to match the `subject` without the `-value` suffix.*

```
// ...
generators: [
  // Import schemas (using filters), assign them to topics, services and domains
  [
    '@eventcatalog/generator-confluent-schema-registry',
      {
        // The URL of your Confluent Schema Registry
        schemaRegistryUrl: 'http://localhost:8081',
        // The producers and consumers (services) to assign schemas to (optional)
        services: [
          {
            id: 'Orders Service',
            version: '1.0.0',
            // Order service publishes events that match the schema name `order-placed` or `order-cancelled`
            sends: [{ events: ['order-placed', 'order-cancelled']},
            // The Order services receives commands that match the schema name `place-order` or `cancel-order`
            receives: [{ commands: ['place-order', 'cancel-order']},
          }
        ],
      },
  ],
];
```

`suffix` matching example - Match schemas that end with a specific string

**What is suffix matching?**

Suffix matching is when the schema name ends with the specified suffix.

In this example, the `Orders Service` will send `events` with a suffix of `placed` and receive `commands` with a suffix of `command`.

Example schemas in registry:

* `order-placed-value`
* `order-cancelled-value`
* `place-order-command-value`
* `cancel-order-command-value`

*Note: EventCatalog matches the `subject` of the schema in the registry. The `subject` in the registry has a suffix of `-value`. This is automatically removed when the schema is assigned to a producer or consumer. So you need to match the `subject` without the `-value` suffix.*

```
// ...
generators: [
  // Import schemas (using filters), assign them to topics, services and domains
  [
    '@eventcatalog/generator-confluent-schema-registry',
      {
        // The URL of your Confluent Schema Registry
        schemaRegistryUrl: 'http://localhost:8081',
        // The producers and consumers (services) to assign schemas to (optional)
        services: [
          {
            id: 'Orders Service',
            version: '1.0.0',
            // Order service publishes events (schemas) with a suffix of `placed`
            sends: [{ events: { suffix: '-placed' }},
            // The Order services receives commands (schemas) with a suffix of `command`
            receives: [{ commands: { suffix: '-command' }},
          }
        ],
      },
  ],
];
```

`prefix` matching example - Match schemas that start with a specific string

In this example, the `Orders Service` will send `events` with a prefix of `order` and receive `commands` with a prefix of `analytics`

Example schemas in registry:

* `order-placed-value`
* `order-cancelled-value`
* `analytics-place-order-value`
* `analytics-cancel-order-value`

*Note: EventCatalog matches the `subject` of the schema in the registry. The `subject` in the registry has a suffix of `-value`. This is automatically removed when the schema is assigned to a producer or consumer. So you need to match the `subject` without the `-value` suffix.*

```
// ...
generators: [
  // Import schemas (using filters), assign them to topics, services and domains
  [
    '@eventcatalog/generator-confluent-schema-registry',
      {
        // The URL of your Confluent Schema Registry
        schemaRegistryUrl: 'http://localhost:8081',
        // The producers and consumers (services) to assign schemas to (optional)
        services: [
          {
            id: 'Orders Service',
            version: '1.0.0',
            // Order service publishes events with a prefix of `order`
            sends: [{ events: { prefix: 'order' }}],
            // The Order services receives commands with a prefix of `analytics`
            receives: [{ commands: { prefix: 'analytics' }}],
          }
        ],
      },
  ],
];
```

`includes` matching example - Match schemas that include a specific string

In this example, the `Orders Service` will send `events` that include the string `order` and receives `commands` that include the string `analytics`

Example schemas in registry:

* `order-placed-value`
* `order-cancelled-value`
* `analytics-place-order-value`
* `analytics-cancel-order-value`

*Note: EventCatalog matches the `subject` of the schema in the registry. The `subject` in the registry has a suffix of `-value`. This is automatically removed when the schema is assigned to a producer or consumer. So you need to match the `subject` without the `-value` suffix.*

```
// ...
generators: [
  // Import schemas (using filters), assign them to topics, services and domains
  [
    '@eventcatalog/generator-confluent-schema-registry',
      {
        // The URL of your Confluent Schema Registry
        schemaRegistryUrl: 'http://localhost:8081',
        // The producers and consumers (services) to assign schemas to (optional)
        services: [
          {
            id: 'Orders Service',
            version: '1.0.0',
            // Order service publishes events with a prefix of `order`
            sends: [{ events: { includes: 'order' }}],
            // The Order services receives commands with a prefix of `analytics`
            receives: [{ commands: { includes: 'analytics' }}],
          }
        ],
      },
  ],
];
```

## Example Configurations[​](#example-configurations "Direct link to Example Configurations")

The Confluent Schema Registry plugin is flexible to work with your use case. Here are a few examples of how you can configure the plugin.

Example configuration - Import all schemas (and versions) into EventCatalog

In this example we import all schemas from the Confluent Schema Registry into EventCatalog. No topics, services or domains are configured or created. This is a simple way to import schemas into the catalog and keep them in sync with your documentation.

Remember your API keys

If you want to use the Confluent Schema Registry plugin, you need to configure your API keys as environment variables in the `.env` file.

eventcatalog.config.js

```
  // ...rest of eventcatalog.config.js file
  generators: [
    [
      '@eventcatalog/generator-confluent-schema-registry',
      {
        // The URL of your Confluent Schema Registry
        schemaRegistryUrl: 'http://localhost:8081',

        // Include all versions of the schemas
        includeAllVersions: true,
      }
    ]
  ],
};
```

Example configuration - Assign schemas to producers and consumers

In this example we assign schemas to producers and consumers (services in EventCatalog).

Remember your API keys

If you want to use the Confluent Schema Registry plugin, you need to configure your API keys as environment variables in the `.env` file.

eventcatalog.config.js

```
  // ...rest of eventcatalog.config.js file
  generators: [
    [
      '@eventcatalog/generator-confluent-schema-registry',
      {
        // The URL of your Confluent Schema Registry
        schemaRegistryUrl: 'http://localhost:8081',
        // The producers and consumers (services) to assign schemas to (optional)
        services: [
          {
            id: 'Orders Service',
            version: '1.0.0',
            // Order service publishes events that match the schema name `order-placed` or `order-cancelled`
            sends: [{ events: ['order-placed', 'order-cancelled']}],
            // The Order services receives commands that match the schema name `place-order` or `cancel-order`
            receives: [{ commands: ['place-order', 'cancel-order']}],
          }
        ]
      }
    ]
  ],
};
```

Example configuration - Assign schemas to producers and consumers (with filters)

In this example we assign schemas to producers and consumers (services in EventCatalog) but we use filters to match the schemas.

Remember your API keys

If you want to use the Confluent Schema Registry plugin, you need to configure your API keys as environment variables in the `.env` file.

eventcatalog.config.js

```
  // ...rest of eventcatalog.config.js file
  generators: [
    [
      '@eventcatalog/generator-confluent-schema-registry',
      {
        // The URL of your Confluent Schema Registry
        schemaRegistryUrl: 'http://localhost:8081',
        // The producers and consumers (services) to assign schemas to (optional)
        services: [
          {
            id: 'Orders Service',
            version: '1.0.0',
            // Order service publishes events that start with `order`
            sends: [{ events: { prefix: 'order' }}],
            // The Order services receives commands that end with `command`
            receives: [{ commands: { suffix: 'command' }}],
          }
        ]
      }
    ]
  ],
};
```

Example configuration - Assign schemas to producers and consumers with topics

In this example we assign schemas to producers and consumers (services in EventCatalog) but we also assign them to *topics*.

Remember your API keys

If you want to use the Confluent Schema Registry plugin, you need to configure your API keys as environment variables in the `.env` file.

eventcatalog.config.js

```
  // ...rest of eventcatalog.config.js file
  generators: [
    [
      '@eventcatalog/generator-confluent-schema-registry',
      {
        // The URL of your Confluent Schema Registry
        schemaRegistryUrl: 'http://localhost:8081',
        // List of kafka topics to assign the schemas to (optional)
        // These will be documented as channels in EventCatalog
        topics: [
          {
            id: 'orders-topic',
            name: 'Orders Topic',
            address: 'kafka-cluster-1.us-east-1.confluent.cloud:9092',
          }
        ],
        // The producers and consumers (services) to assign schemas to (optional)
        services: [
          {
            id: 'Orders Service',
            version: '1.0.0',
            // Order service publishes events that start with `order` using the `orders-topic` (channel)
            sends: [{ events: { prefix: 'order' }, topic: 'orders-topic'}],
            // The Order services receives commands that end with `command` using the `orders-topic` (channel)
            receives: [{ commands: { suffix: 'command' }, topic: 'orders-topic'}],
          }
        ]
      }
    ]
  ],
};
```

Example configuration - Assign schemas to producers and consumers within a domain

In this example we assign schemas to producers and consumers (services in EventCatalog) but we also assign them to a *domain*.

Remember your API keys

If you want to use the Confluent Schema Registry plugin, you need to configure your API keys as environment variables in the `.env` file.

eventcatalog.config.js

```
  // ...rest of eventcatalog.config.js file
  generators: [
    [
      '@eventcatalog/generator-confluent-schema-registry',
      {
        // The URL of your Confluent Schema Registry
        schemaRegistryUrl: 'http://localhost:8081',
        // The producers and consumers (services) to assign schemas to (optional)
        services: [
          {
            id: 'Orders Service',
            version: '1.0.0',
            // Order service publishes events that match the schema name `order-placed` or `order-cancelled`
            sends: [{ events: ['order-placed', 'order-cancelled']}],
            // The Order services receives commands that match the schema name `place-order` or `cancel-order`
            receives: [{ commands: ['place-order', 'cancel-order']}],
          }
        ],
        // The domain to assign the service (orders-service) to
        // if it does not exist, it will be created
        domain: {
          id: 'orders-domain',
          name: 'Orders Domain',
          version: '1.0.0',
        }
      }
    ]
  ],
};
```

## Need help?[​](#need-help "Direct link to Need help?")

If you have questions or need help, you can join our [Discord community](https://eventcatalog.dev/discord) or refer to the [Confluent Schema Registry examples on GitHub](https://github.com/event-catalog/generators/tree/main/examples/generator-confluent-schema-registry).
