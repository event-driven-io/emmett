import { AsyncAPIDocumentInterface, MessageInterface, Parser, fromFile, fromURL } from '@asyncapi/parser';
import utils from '@eventcatalog/sdk';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import argv from 'minimist';
import yaml from 'js-yaml';
import { z } from 'zod';
import chalk from 'chalk';
import path from 'path';
import pkgJSON from '../package.json';
import { checkForPackageUpdate } from '../../../shared/check-for-package-update';

// AsyncAPI Parsers
import { AvroSchemaParser } from '@asyncapi/avro-schema-parser';

import {
  defaultMarkdown as generateMarkdownForMessage,
  getMessageName,
  getSummary as getMessageSummary,
  getSchemaFileName,
  messageHasSchema,
} from './utils/messages';
import { defaultMarkdown as generateMarkdownForService, getSummary as getServiceSummary } from './utils/services';
import { defaultMarkdown as generateMarkdownForDomain } from './utils/domains';
import { defaultMarkdown as generateMarkdownForChannel, getChannelProtocols, getChannelTags } from './utils/channels';
import { isNewerVersion, isSameVersion } from './utils/versions';
import checkLicense from '../../../shared/checkLicense';

import { EventType, MessageOperations } from './types';
import { join } from 'node:path';

const parser = new Parser();

/**
 * Deep copy that breaks circular references while preserving shared (non-circular)
 * references. When a true cycle is detected, it uses the `x-parser-schema-id` property
 * to reconstruct a valid JSON Schema `$ref` (e.g. `#/components/schemas/MySchema`).
 *
 * Ancestors are tracked (rather than every object ever seen) because parsed AsyncAPI
 * documents contain shared references that are not circular — e.g. each operation's
 * dereferenced `channel` is the same object as the entry under the root `channels`
 * object. Replacing those with a `$ref` produces an invalid spec that fails to re-parse.
 */
const breakCircularReferences = (value: unknown, ancestors = new WeakSet()): unknown => {
  if (typeof value !== 'object' || value === null) return value;

  if (ancestors.has(value)) {
    const schemaId = (value as Record<string, unknown>)['x-parser-schema-id'];
    if (schemaId && typeof schemaId === 'string') {
      return { $ref: `#/components/schemas/${schemaId}` };
    }
    return { $ref: '#' };
  }

  ancestors.add(value);

  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((item) => breakCircularReferences(item, ancestors));
  } else {
    const obj: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      obj[key] = breakCircularReferences(item, ancestors);
    }
    result = obj;
  }

  ancestors.delete(value);
  return result;
};

/**
 * Safely stringify objects that may contain circular references.
 */
const safeStringify = (obj: unknown, indent?: number): string => JSON.stringify(breakCircularReferences(obj), null, indent);

// register avro schema support
parser.registerSchemaParser(AvroSchemaParser());
const cliArgs = argv(process.argv.slice(2));

const optionsSchema = z.object({
  licenseKey: z.string().optional(),
  writeFilesToRoot: z.boolean().optional(),
  preserveExistingMessages: z.boolean().optional(),
  services: z.array(
    z.object({
      id: z.string({ required_error: 'The service id is required. please provide the service id' }),
      version: z.string().optional(),
      path: z.string({ required_error: 'The service path is required. please provide the path to specification file' }),
      draft: z.boolean().optional(),
      name: z.string().optional(),
      summary: z.string().optional(),
      writesTo: z.array(z.object({ id: z.string(), version: z.string().optional() })).optional(),
      readsFrom: z.array(z.object({ id: z.string(), version: z.string().optional() })).optional(),
      owners: z.array(z.string()).optional(),
      headers: z.record(z.string()).optional(),
      generateMarkdown: z
        .function()
        .args(
          z.object({
            service: z.object({
              id: z.string(),
              name: z.string(),
              version: z.string(),
            }),
            // AsyncAPI Interface
            document: z.any(),
            markdown: z.string().optional(),
          })
        )
        .returns(z.string())
        .optional(),
    }),
    { message: 'Please provide correct services configuration' }
  ),
  messages: z
    .object({
      id: z
        .object({
          lowerCase: z.boolean().optional(),
          prefix: z.string().optional(),
          separator: z.string().optional(),
          prefixWithServiceId: z.boolean().optional(),
        })
        .optional(),
      generateMarkdown: z
        .function()
        .args(
          z.object({
            message: z.any(),
            document: z.any(),
            markdown: z.string().optional(),
          })
        )
        .returns(z.string())
        .optional(),
    })
    .optional(),
  domain: z
    .object({
      id: z.string({ required_error: 'The domain id is required. please provide a domain id' }),
      name: z.string({ required_error: 'The domain name is required. please provide a domain name' }),
      owners: z.array(z.string()).optional(),
      version: z.string({ required_error: 'The domain version is required. please provide a domain version' }),
      draft: z.boolean().optional(),
      // function that takes options (including domain) and returns a string
      generateMarkdown: z
        .function()
        .args(
          z.object({
            domain: z.object({
              id: z.string(),
              name: z.string(),
              version: z.string(),
            }),
            markdown: z.string().optional(),
          })
        )
        .returns(z.string())
        .optional(),
    })
    .optional(),
  debug: z.boolean().optional(),
  parseSchemas: z.boolean().optional(),
  parseChannels: z.boolean().optional(),
  parseExamples: z.boolean().optional(),
  attachHeadersToSchema: z.boolean().optional(),
  saveParsedSpecFile: z.boolean({ invalid_type_error: 'The saveParsedSpecFile is not a boolean in options' }).optional(),
  /**
   * Group messages in the visualiser using the `x-eventcatalog-group` extension
   * on each message in the AsyncAPI spec.
   */
  groupMessagesBy: z.enum(['x-extension']).optional(),
});

type Props = z.infer<typeof optionsSchema>;
type Domain = z.infer<typeof optionsSchema>['domain'];
type Service = z.infer<typeof optionsSchema>['services'][0];

const toUniqueArray = (array: { id: string; version: string }[]) => {
  return array.filter((item, index, self) => index === self.findIndex((t) => t.id === item.id && t.version === item.version));
};

// Consolidate sends/receives entries that share the same message id+version by merging their to/from channel arrays
const consolidateMessages = <T extends { id: string; version?: string; to?: any[]; from?: any[] }>(array: T[]): T[] => {
  const map = new Map<string, T>();
  for (const item of array) {
    const key = `${item.id}::${item.version}`;
    const existing = map.get(key);
    if (existing) {
      if (item.to) {
        const merged = [...(existing.to || []), ...item.to];
        existing.to = merged.filter((ch, i, arr) => i === arr.findIndex((c) => c.id === ch.id));
      }
      if (item.from) {
        const merged = [...(existing.from || []), ...item.from];
        existing.from = merged.filter((ch, i, arr) => i === arr.findIndex((c) => c.id === ch.id));
      }
    } else {
      map.set(key, { ...item });
    }
  }
  return Array.from(map.values());
};

// Helper to merge asyncapi path into existing specifications, preserving format (array or object)
const mergeAsyncApiIntoSpecifications = (existingSpecs: any, asyncapiFileName: string): any => {
  if (Array.isArray(existingSpecs)) {
    return [...existingSpecs.filter((spec: any) => spec.type !== 'asyncapi'), { type: 'asyncapi', path: asyncapiFileName }];
  }
  return { ...existingSpecs, asyncapiPath: asyncapiFileName };
};

const validateOptions = (options: Props) => {
  try {
    optionsSchema.parse(options);
  } catch (error: any) {
    if (error instanceof z.ZodError) throw new Error(JSON.stringify(error.issues, null, 2));
  }
};

export default async (config: any, options: Props) => {
  if (!process.env.PROJECT_DIR) {
    process.env.PROJECT_DIR = process.cwd();
  }

  if (!process.env.PROJECT_DIR) {
    throw new Error('Please provide catalog url (env variable PROJECT_DIR)');
  }

  // Check for license and package update
  const LICENSE_KEY: string = process.env.EVENTCATALOG_LICENSE_KEY_ASYNCAPI || options.licenseKey || '';
  await checkLicense(pkgJSON.name, LICENSE_KEY, { allowEventCatalogScaleLicense: true });
  await checkForPackageUpdate(pkgJSON.name);

  const {
    writeService,
    writeEvent,
    writeCommand,
    writeQuery,
    getService,
    versionService,
    getDomain,
    writeDomain,
    addServiceToDomain,
    getCommand,
    getEvent,
    getQuery,
    versionCommand,
    versionEvent,
    versionQuery,
    rmCommandById,
    rmEventById,
    rmQueryById,
    addSchemaToCommand,
    addSchemaToEvent,
    addSchemaToQuery,
    addFileToService,
    versionDomain,
    getResourcePath,
    getSpecificationFilesForService,
    writeChannel,
    getChannel,
    versionChannel,
    addExampleToEvent,
    addExampleToCommand,
    addExampleToQuery,
  } = utils(process.env.PROJECT_DIR);

  // Define the message operations mapping with proper types
  const MESSAGE_OPERATIONS: Record<EventType, MessageOperations> = {
    event: {
      write: writeEvent,
      version: versionEvent,
      get: getEvent,
      remove: rmEventById,
      addSchema: addSchemaToEvent,
      addExample: addExampleToEvent,
      collection: 'events',
    },
    command: {
      write: writeCommand,
      version: versionCommand,
      get: getCommand,
      remove: rmCommandById,
      addSchema: addSchemaToCommand,
      addExample: addExampleToCommand,
      collection: 'commands',
    },
    query: {
      write: writeQuery,
      version: versionQuery,
      get: getQuery,
      remove: rmQueryById,
      addSchema: addSchemaToQuery,
      addExample: addExampleToQuery,
      collection: 'queries',
    },
  };

  // Should the file that is written to the catalog be parsed (https://github.com/asyncapi/parser-js) or as it is?
  validateOptions(options);

  const {
    services,
    saveParsedSpecFile = false,
    parseSchemas = true,
    parseChannels = false,
    parseExamples = true,
    attachHeadersToSchema = false,
    preserveExistingMessages = true,
  } = options;
  // const asyncAPIFiles = Array.isArray(options.path) ? options.path : [options.path];
  console.log(chalk.green(`Processing ${services.length} AsyncAPI files...`));
  for (const service of services) {
    console.log(chalk.gray(`Processing ${service.path}`));

    const { document, diagnostics } = service.path.startsWith('http')
      ? await fromURL(parser, service.path, { headers: service.headers }).parse({
          parseSchemas,
        })
      : await fromFile(parser, service.path).parse({
          parseSchemas,
        });

    if (!document) {
      console.log(chalk.red('Failed to parse AsyncAPI file'));
      if (options.debug || cliArgs.debug) {
        console.log(diagnostics);
      } else {
        console.log(chalk.red('Run with debug option in the generator to see diagnostics'));
      }
      continue;
    }

    const operations = document.allOperations();
    const channels = document.allChannels();
    const documentTags = document.info().tags().all() || [];
    const isDomainMarkedAsDraft = options.domain?.draft || false;
    const isServiceMarkedAsDraft =
      isDomainMarkedAsDraft || document.info().extensions().get('x-eventcatalog-draft')?.value() || service.draft || false;

    const serviceId = service.id;

    const serviceName = service.name || document.info().title();
    const version = service.version || document.info().version();

    // What messages does this service send and receive
    let sends = [];
    let receives = [];

    let owners = service.owners || null;
    let repository = null;
    let badges = null;
    let attachments = null;
    let diagrams = null;
    let flows = null;
    let entities = null;

    let serviceSpecifications: any = {};
    let serviceSpecificationsFiles: Array<{ fileName: string; content: string }> = [];
    let configuredWritesTo = service.writesTo || ([] as any);
    let configuredReadsFrom = service.readsFrom || ([] as any);
    let serviceWritesTo = configuredWritesTo;
    let serviceReadsFrom = configuredReadsFrom;

    const generatedMarkdownForService = generateMarkdownForService(document);
    let serviceMarkdown = service.generateMarkdown
      ? service.generateMarkdown({
          service: { id: service.id, name: serviceName, version },
          document,
          markdown: generatedMarkdownForService,
        })
      : generatedMarkdownForService;
    let styles = null;
    // Manage domain
    if (options.domain) {
      // Try and get the domain
      const { id: domainId, name: domainName, version: domainVersion, owners: domainOwners } = options.domain;
      const domain = await getDomain(options.domain.id, domainVersion || 'latest');
      const currentDomain = await getDomain(options.domain.id, 'latest');
      const domainIsDraft = isDomainMarkedAsDraft || currentDomain?.draft || false;

      console.log(chalk.blue(`\nProcessing domain: ${domainName} (v${domainVersion})`));

      // Found a domain, but the versions do not match
      if (currentDomain && currentDomain.version !== domainVersion) {
        await versionDomain(domainId);
        console.log(chalk.cyan(` - Versioned previous domain (v${currentDomain.version})`));
      }

      // Do we need to create a new domain?
      if (!domain || (domain && domain.version !== domainVersion)) {
        const generatedMarkdownForDomain = generateMarkdownForDomain(document);
        await writeDomain({
          id: domainId,
          name: domainName,
          version: domainVersion,
          markdown: options.domain?.generateMarkdown
            ? options.domain.generateMarkdown({ domain: options.domain, markdown: generatedMarkdownForDomain })
            : generatedMarkdownForDomain,
          ...(domainOwners && { owners: domainOwners }),
          ...(domainIsDraft && { draft: true }),
          // services: [{ id: serviceId, version: version }],
        });
        console.log(chalk.cyan(` - Domain (v${domainVersion}) created`));
      }

      if (currentDomain && currentDomain.version === domainVersion) {
        console.log(chalk.yellow(` - Domain (v${domainVersion}) already exists, skipped creation...`));
      }

      // Add the service to the domain
      await addServiceToDomain(domainId, { id: serviceId, version: version }, domainVersion);
    }

    // Have to ../ as the SDK will put the files into hard coded folders
    // Use getResourcePath to resolve the actual domain location (supports subdomains)
    let servicePath = path.join('../', 'services', service.id);
    if (options.domain) {
      const domainResource = await getResourcePath(process.env.PROJECT_DIR as string, options.domain.id, options.domain.version);
      if (domainResource) {
        servicePath = path.join('../', domainResource.directory, 'services', service.id);
      } else {
        servicePath = path.join('../', 'domains', options.domain.id, 'services', service.id);
      }
    } else {
      // No domain configured, but the service may already exist somewhere in the catalog
      // (e.g. inside a domain). Write back in-place so we don't duplicate it at /services.
      const existingService = await getService(serviceId, 'latest');
      if (existingService) {
        const existingServiceResource = await getResourcePath(
          process.env.PROJECT_DIR as string,
          serviceId,
          existingService.version
        );
        if (existingServiceResource) {
          servicePath = path.join('../', existingServiceResource.directory);
        }
      }
    }
    if (options.writeFilesToRoot) {
      servicePath = service.id;
    }

    // Parse channels
    if (parseChannels) {
      for (const channel of channels) {
        const channelAsJSON = channel.json();
        const channelId = channel.id();
        const params = channelAsJSON?.parameters || {};
        const protocols = getChannelProtocols(channel);
        const channelTags: string[] = getChannelTags(channel);
        const channelVersion = channel.extensions().get('x-eventcatalog-channel-version')?.value() || version;
        let channelMarkdown = generateMarkdownForChannel(document, channel);

        console.log(chalk.blue(`Processing channel: ${channelId} (v${channelVersion})`));

        const paramsForCatalog = Object.keys(params).reduce(
          (acc, key) => {
            const param = params[key];
            acc[key] = {};
            if (param.enum) acc[key].enum = param.enum;
            if (param.default) acc[key].default = param.default;
            if (param.examples) acc[key].examples = param.examples;
            if (param.description) acc[key].description = param.description;
            return acc;
          },
          {} as Record<string, { enum?: string[]; default?: string; examples?: string[]; description?: string }>
        );

        const catalogedChannel = await getChannel(channelId, 'latest');

        if (catalogedChannel) {
          channelMarkdown = catalogedChannel.markdown;
          if (catalogedChannel.version !== channelVersion) {
            await versionChannel(channelId);
            console.log(chalk.cyan(` - Versioned previous channel: ${channelId} (v${channelVersion})`));
          }
        }

        await writeChannel(
          {
            id: channelId,
            name: channelAsJSON?.title || channel.id(),
            markdown: channelMarkdown,
            version: channelVersion,
            ...(Object.keys(paramsForCatalog).length > 0 && { parameters: paramsForCatalog }),
            ...(channel.address() && { address: channel.address() }),
            ...(channelAsJSON?.summary && { summary: channelAsJSON.summary }),
            ...(channelTags.length > 0 && {
              badges: channelTags.map((tagName) => ({ content: tagName, textColor: 'blue', backgroundColor: 'blue' })),
            }),
            ...(protocols.length > 0 && { protocols }),
            ...((isDomainMarkedAsDraft || isServiceMarkedAsDraft) && { draft: true }),
          },
          { override: true }
        );

        console.log(chalk.cyan(` - Message ${channelId} (v${version}) created`));
      }
    }

    // Find events/commands
    for (const operation of operations) {
      for (const message of operation.messages()) {
        const eventType = (message.extensions().get('x-eventcatalog-message-type')?.value() as EventType) || 'event';
        let messageVersion = message.extensions().get('x-eventcatalog-message-version')?.value() || version;
        const deprecatedDate = message.extensions().get('x-eventcatalog-deprecated-date')?.value() || null;
        const deprecatedMessage = message.extensions().get('x-eventcatalog-deprecated-message')?.value() || null;
        const isMessageMarkedAsDraft =
          isDomainMarkedAsDraft || isServiceMarkedAsDraft || message.extensions().get('x-eventcatalog-draft')?.value() || null;

        // Does this service own, reference, or treat the message as external?
        const messageOwnership = getMessageOwnership(message, operation);
        const serviceOwnsMessageContract = messageOwnership === 'owner';
        const isReceived = operation.action() === 'receive' || operation.action() === 'subscribe';
        const isSent = operation.action() === 'send' || operation.action() === 'publish';

        let messageId = options.messages?.id?.lowerCase ? message.id().toLowerCase() : message.id();
        const messageName = messageId;

        if (eventType !== 'event' && eventType !== 'command' && eventType !== 'query') {
          throw new Error('Invalid message type');
        }

        if (options.messages?.id?.prefix) {
          messageId = [options.messages.id.prefix, messageId].join(options.messages.id.separator || '-');
        }

        if (options.messages?.id?.prefixWithServiceId) {
          messageId = [serviceId, messageId].join(options.messages.id.separator || '-');
        }

        const {
          write: writeMessage,
          version: versionMessage,
          get: getMessage,
          remove: removeMessage,
          addSchema: addSchemaToMessage,
          addExample: addExampleToMessage,
          collection: folder,
        } = MESSAGE_OPERATIONS[eventType];

        const generatedMarkdownForMessage = generateMarkdownForMessage(document, message);
        let messageMarkdown = options.messages?.generateMarkdown
          ? options.messages.generateMarkdown({ message, document, markdown: generatedMarkdownForMessage })
          : generatedMarkdownForMessage;
        const badges = message.tags().all() || [];

        let messageBadges = null;
        let messageAttachments = null;

        console.log(chalk.blue(`Processing message: ${getMessageName(message)} (v${messageVersion})`));

        let messagePath = join(servicePath, folder, messageName);
        if (options.writeFilesToRoot) {
          messagePath = messageId;
        }

        if (messageOwnership === 'external') {
          // An explicit client role means the contract is owned outside this service.
          console.log(chalk.yellow(` - Skipping external message: ${getMessageName(message)}(v${messageVersion})`));
        } else {
          // Check if the message already exists in the catalog
          const catalogedMessage = await getMessage(messageId, 'latest');
          let shouldWriteMessage = true;
          let existingMessageDirectoryToRelocate: string | null = null;

          if (serviceOwnsMessageContract && catalogedMessage) {
            // Always preserve user-managed badges and attachments.
            messageBadges = catalogedMessage.badges || null;
            messageAttachments = catalogedMessage.attachments || null;

            if (preserveExistingMessages) {
              messageMarkdown = catalogedMessage.markdown;
            }

            const catalogedVersion = catalogedMessage.version ?? '';

            if (isSameVersion(catalogedVersion, messageVersion)) {
              // Same version - continue and overwrite the message in place
              const catalogedMessagePath = await getResourcePath(process.env.PROJECT_DIR as string, messageId, catalogedVersion);
              const targetMessageDirectory = path.resolve(process.env.PROJECT_DIR as string, folder, messagePath);
              const catalogedMessageDirectory = catalogedMessagePath ? path.dirname(catalogedMessagePath.fullPath) : null;

              if (
                catalogedMessageDirectory &&
                path.normalize(catalogedMessageDirectory) !== path.normalize(targetMessageDirectory)
              ) {
                existingMessageDirectoryToRelocate = catalogedMessageDirectory;
              }
            } else if (isNewerVersion(messageVersion, catalogedVersion)) {
              // Incoming is strictly newer - version the cataloged one and write the new one at root
              await versionMessage(messageId);
              console.log(chalk.cyan(` - Versioned previous message: (v${catalogedMessage.version})`));
            } else {
              // Incoming is older than (or not confidently newer than) the cataloged version.
              // Leave the cataloged entry alone and point the service's sends/receives at it.
              console.log(
                chalk.yellow(
                  ` - Skipping ${messageId} (v${messageVersion}) - catalog already has a newer version (v${catalogedVersion})`
                )
              );
              messageVersion = catalogedVersion;
              shouldWriteMessage = false;
            }
          } else if (!serviceOwnsMessageContract && catalogedMessage) {
            // A receiver references the owner's existing contract and version without writing
            // another copy beneath the receiving service.
            console.log(
              chalk.yellow(` - Referencing existing message ${messageId} (v${catalogedMessage.version}) without overwriting`)
            );
            messageVersion = catalogedMessage.version ?? messageVersion;
            shouldWriteMessage = false;
          }

          if (shouldWriteMessage) {
            if (existingMessageDirectoryToRelocate) {
              const targetMessageDirectory = path.resolve(process.env.PROJECT_DIR as string, folder, messagePath);

              // A receiver may have created a fallback before the owner was generated. Move
              // that resource to the owner's location so the catalog retains one shared
              // contract while preserving any files already attached to the fallback.
              await removeMessage(messageId, messageVersion, true);
              await mkdir(path.dirname(targetMessageDirectory), { recursive: true });
              await cp(existingMessageDirectoryToRelocate, targetMessageDirectory, {
                recursive: true,
                force: true,
              });
              await rm(existingMessageDirectoryToRelocate, { recursive: true, force: true });
            }

            await writeMessage(
              {
                id: messageId,
                version: messageVersion,
                name: getMessageName(message),
                summary: getMessageSummary(message),
                markdown: messageMarkdown,
                badges:
                  messageBadges || badges.map((badge) => ({ content: badge.name(), textColor: 'blue', backgroundColor: 'blue' })),
                ...(messageHasSchema(message) && { schemaPath: getSchemaFileName(message) }),
                ...(owners && { owners }),
                ...(messageAttachments && { attachments: messageAttachments }),
                ...(deprecatedDate && {
                  deprecated: { date: deprecatedDate, ...(deprecatedMessage && { message: deprecatedMessage }) },
                }),
                ...(isMessageMarkedAsDraft && { draft: true }),
              },
              {
                // References only reach this branch when the message is missing. They may
                // create a fallback, but only owners may replace an existing contract.
                override: serviceOwnsMessageContract,
                path: messagePath,
              }
            );

            console.log(chalk.cyan(` - Message (v${messageVersion}) created`));

            // Check if the message has a payload, if it does then document in EventCatalog
            if (messageHasSchema(message)) {
              const schema = getSchemaForMessage(message, attachHeadersToSchema);

              // Normalize path separators and remove leading relative path segments (../ or ./ for both Unix and Windows)
              const cleanedMessagePath = messagePath
                .replace(/\\/g, '/') // Convert all backslashes to forward slashes
                .replace(/^(\.\.\/|\.\/)+/g, ''); // Remove all leading ../ or ./ segments

              await addSchemaToMessage(
                messageId,
                {
                  fileName: getSchemaFileName(message),
                  schema: safeStringify(schema, 4),
                },
                messageVersion,
                { path: cleanedMessagePath }
              );
              console.log(chalk.cyan(` - Schema added to message (v${messageVersion})`));
            }

            // Add examples to the message if parseExamples is enabled
            if (parseExamples) {
              const messageExamples = message.examples().all();
              for (let i = 0; i < messageExamples.length; i++) {
                const example = messageExamples[i];
                const payload = example.payload();
                if (payload) {
                  const fileName = example.hasName() ? `${example.name()}.json` : `example-${i}.json`;
                  await addExampleToMessage(messageId, { content: JSON.stringify(payload, null, 2), fileName }, messageVersion);
                }
              }
              if (messageExamples.length > 0) {
                console.log(chalk.cyan(` - ${messageExamples.length} example(s) added to message (v${messageVersion})`));
              }
            }
          }
        }
        // Derive group from x-eventcatalog-group extension if groupMessagesBy is configured
        const group =
          options.groupMessagesBy === 'x-extension'
            ? message.extensions().get('x-eventcatalog-group')?.value() || undefined
            : undefined;

        // Add the message to the correct array, with channel info if parseChannels is enabled
        if (parseChannels) {
          const operationChannels = operation.channels().all();
          // Only include version if x-eventcatalog-channel-version is explicitly set, otherwise defaults to "latest"
          const channelPointers = operationChannels.map((channel) => {
            const explicitVersion = channel.extensions().get('x-eventcatalog-channel-version')?.value();
            return { id: channel.id(), ...(explicitVersion && { version: explicitVersion }) };
          });

          if (isSent)
            sends.push({
              id: messageId,
              version: messageVersion,
              ...(channelPointers.length > 0 && { to: channelPointers }),
              ...(group && { group }),
            });
          if (isReceived)
            receives.push({
              id: messageId,
              version: messageVersion,
              ...(channelPointers.length > 0 && { from: channelPointers }),
              ...(group && { group }),
            });
        } else {
          if (isSent) sends.push({ id: messageId, version: messageVersion, ...(group && { group }) });
          if (isReceived) receives.push({ id: messageId, version: messageVersion, ...(group && { group }) });
        }
      }
    }

    // Check if service is already defined... if the versions do not match then create service.
    const latestServiceInCatalog = await getService(serviceId, 'latest');

    console.log(chalk.blue(`Processing service: ${serviceId} (v${version})`));

    if (latestServiceInCatalog) {
      // persist data between versioning and matching
      serviceMarkdown = latestServiceInCatalog.markdown;
      owners = latestServiceInCatalog.owners || owners;
      repository = latestServiceInCatalog.repository || null;
      styles = latestServiceInCatalog.styles || null;
      badges = latestServiceInCatalog.badges || null;
      attachments = latestServiceInCatalog.attachments || null;
      diagrams = latestServiceInCatalog.diagrams || null;
      flows = latestServiceInCatalog.flows || null;
      entities = latestServiceInCatalog.entities || null;
      // persist writesTo and readsFrom
      serviceWritesTo = latestServiceInCatalog.writesTo ? latestServiceInCatalog.writesTo : configuredWritesTo;
      serviceReadsFrom = latestServiceInCatalog.readsFrom ? latestServiceInCatalog.readsFrom : configuredReadsFrom;

      // Found a service, and versions do not match, we need to version the one already there
      if (latestServiceInCatalog.version !== version) {
        await versionService(serviceId);
        console.log(chalk.cyan(` - Versioned previous service (v${latestServiceInCatalog.version})`));
      }

      // Match found, persist data
      if (latestServiceInCatalog.version === version) {
        serviceMarkdown = latestServiceInCatalog.markdown;
        serviceSpecifications = latestServiceInCatalog.specifications ?? {};
        sends = latestServiceInCatalog.sends ? [...latestServiceInCatalog.sends, ...sends] : sends;
        receives = latestServiceInCatalog.receives ? [...latestServiceInCatalog.receives, ...receives] : receives;
        serviceSpecificationsFiles = await getSpecificationFilesForService(serviceId, version);
        serviceWritesTo = latestServiceInCatalog.writesTo
          ? toUniqueArray([...latestServiceInCatalog.writesTo, ...configuredWritesTo])
          : configuredWritesTo;
        serviceReadsFrom = latestServiceInCatalog.readsFrom
          ? toUniqueArray([...latestServiceInCatalog.readsFrom, ...configuredReadsFrom])
          : configuredReadsFrom;
      }
    }

    const fileName = path.basename(service.path);

    // Consolidate sends/receives so the same message sent to multiple channels has all channels in one entry
    sends = consolidateMessages(sends);
    receives = consolidateMessages(receives);

    await writeService(
      {
        id: serviceId,
        name: serviceName,
        version: version,
        summary: service.summary || getServiceSummary(document),
        badges: badges || documentTags.map((tag) => ({ content: tag.name(), textColor: 'blue', backgroundColor: 'blue' })),
        markdown: serviceMarkdown,
        sends,
        receives,
        schemaPath: fileName || 'asyncapi.yml',
        specifications: mergeAsyncApiIntoSpecifications(serviceSpecifications, fileName || 'asyncapi.yml'),
        ...(owners && { owners }),
        ...(repository && { repository }),
        ...(styles && { styles }),
        ...(diagrams && { diagrams }),
        ...(flows && { flows }),
        ...(entities && { entities }),
        ...(isServiceMarkedAsDraft && { draft: true }),
        ...(attachments && { attachments }),
        ...(serviceWritesTo.length > 0 ? { writesTo: serviceWritesTo } : {}),
        ...(serviceReadsFrom.length > 0 ? { readsFrom: serviceReadsFrom } : {}),
      },
      {
        path: servicePath,
        override: true,
      }
    );

    // What files need added to the service (speficiation files)
    const specFiles = [
      // add any previous spec files to the list
      ...serviceSpecificationsFiles,
      {
        content: saveParsedSpecFile ? getParsedSpecFile(service, document) : await getRawSpecFile(service),
        fileName: path.basename(service.path) || 'asyncapi.yml',
      },
    ];

    for (const specFile of specFiles) {
      await addFileToService(
        serviceId,
        {
          fileName: specFile.fileName,
          content: specFile.content,
        },
        version
      );
    }

    console.log(chalk.cyan(` - Service (v${version}) created`));

    console.log(chalk.green(`\nFinished generating event catalog for AsyncAPI ${serviceId} (v${version})`));
  }
};

const getParsedSpecFile = (service: Service, document: AsyncAPIDocumentInterface) => {
  const isSpecFileJSON = service.path.endsWith('.json');
  return isSpecFileJSON
    ? safeStringify(document.meta().asyncapi.parsed, 4)
    : yaml.dump(breakCircularReferences(document.meta().asyncapi.parsed), { noRefs: true });
};

const getRawSpecFile = async (service: Service) => {
  if (service.path.startsWith('http')) {
    try {
      const fetchOptions: RequestInit = { method: 'GET' };
      if (service.headers && Object.keys(service.headers).length > 0) {
        fetchOptions.headers = service.headers;
      }
      const response = await fetch(service.path, fetchOptions);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.text();
    } catch (error) {
      console.log(chalk.red(`\nFailed to request AsyncAPI file from ${service.path}`));
      return '';
    }
  } else {
    return await readFile(service.path, 'utf8');
  }
};

const getSchemaForMessage = (message: MessageInterface, attachHeadersToSchema: boolean) => {
  const payloadSchema = getSchemaFromMessagePart(
    message.payload()?.extensions()?.get('x-parser-original-payload')?.json() || message.payload()?.json()
  );

  if (!attachHeadersToSchema || !message.hasHeaders() || !isJSONSchemaMessage(message)) {
    return payloadSchema;
  }

  const headersSchema = getSchemaFromMessagePart(
    message.headers()?.extensions()?.get('x-parser-original-payload')?.json() || message.headers()?.json()
  );

  if (!headersSchema) {
    return payloadSchema;
  }

  return {
    type: 'object',
    properties: {
      headers: headersSchema,
      payload: payloadSchema,
    },
  };
};

const getSchemaFromMessagePart = (schema: any) => {
  // Some parsers return { schemaFormat, schema }, but EventCatalog only needs the schema object itself.
  if (schema?.schema) {
    return schema.schema;
  }
  return schema;
};

const isJSONSchemaMessage = (message: MessageInterface) => {
  return getSchemaFileName(message).endsWith('.json');
};
/**
 * How the service described by the AsyncAPI document relates to a message.
 *
 * Explicit operation- or message-level roles retain their existing meaning and
 * take precedence over the operation action. Without an explicit role, senders
 * own the contract and receivers only reference it.
 */
type MessageOwnership = 'owner' | 'reference' | 'external';

const getMessageOwnership = (
  message: MessageInterface,
  operation?: { extensions: () => any; action?: () => string }
): MessageOwnership => {
  // Prefer operation-level overrides for shared messages whose role differs per operation.
  const operationRole = operation?.extensions?.().get?.('x-eventcatalog-role')?.value?.();
  const messageRole = message.extensions().get('x-eventcatalog-role')?.value();
  const explicitRole = operationRole || messageRole;

  if (explicitRole) {
    return explicitRole === 'provider' ? 'owner' : 'external';
  }

  const action = operation?.action?.();
  if (action === 'receive' || action === 'subscribe') {
    return 'reference';
  }

  return 'owner';
};
