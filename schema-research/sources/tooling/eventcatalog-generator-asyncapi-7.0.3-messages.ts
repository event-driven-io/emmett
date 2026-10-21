import {
  MessageInterface,
  AsyncAPIDocumentInterface,
  ChannelInterface,
  ChannelsInterface,
  MessagesInterface,
} from '@asyncapi/parser';
import { getFileExtentionFromSchemaFormat } from './schemas';

/**
 * Format protocol name for display (e.g., "googlepubsub" -> "Google PubSub")
 */
const formatProtocolName = (protocol: string): string => {
  const protocolNames: Record<string, string> = {
    googlepubsub: 'Google PubSub',
    kafka: 'Kafka',
    amqp: 'AMQP',
    mqtt: 'MQTT',
    http: 'HTTP',
    ws: 'WebSocket',
    nats: 'NATS',
    jms: 'JMS',
    sns: 'SNS',
    sqs: 'SQS',
    redis: 'Redis',
    solace: 'Solace',
    pulsar: 'Pulsar',
    ibmmq: 'IBM MQ',
    anypointmq: 'Anypoint MQ',
  };
  return protocolNames[protocol.toLowerCase()] || protocol;
};

/**
 * Format a value for display in markdown table
 */
const formatValueForTable = (value: unknown): string => {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'object') {
    return `\`${JSON.stringify(value)}\``;
  }
  return String(value);
};

/**
 * Format binding data as a markdown table
 */
const formatBindingAsTable = (data: Record<string, unknown>): string => {
  if (!data || Object.keys(data).length === 0) return '';

  // Skip internal/meta fields
  const skipFields = ['bindingVersion'];

  let rows: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (skipFields.includes(key)) continue;

    // Handle nested objects like "attributes" for Google PubSub
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const nestedObj = value as Record<string, unknown>;
      for (const [nestedKey, nestedValue] of Object.entries(nestedObj)) {
        rows.push(`| ${key}.${nestedKey} | ${formatValueForTable(nestedValue)} |`);
      }
    } else {
      rows.push(`| ${key} | ${formatValueForTable(value)} |`);
    }
  }

  if (rows.length === 0) return '';

  return `| Property | Value |\n|----------|-------|\n${rows.join('\n')}\n\n`;
};

/**
 * Extract message bindings and format as markdown
 */
export const getMessageBindingsMarkdown = (message: MessageInterface): string => {
  const bindings = message.bindings();
  if (!bindings || bindings.isEmpty()) return '';

  let markdown = '## Bindings\n\n';

  for (const binding of bindings) {
    const protocol = binding.protocol();
    const data = binding.value() as Record<string, unknown>;

    markdown += `### ${formatProtocolName(protocol)}\n\n`;
    markdown += formatBindingAsTable(data);
  }

  return markdown;
};

export const defaultMarkdown = (_document: AsyncAPIDocumentInterface, message: MessageInterface) => {
  return `
## Architecture
<NodeGraph />

${
  messageHasSchema(message) && messageIsJSON(message)
    ? `
## Schema
<SchemaViewer file="${getSchemaFileName(message)}" title="Message Schema" maxHeight="500" />
`
    : ''
}
${
  messageHasSchema(message) && !messageIsJSON(message)
    ? `
## Schema
<Schema file="${getSchemaFileName(message)}" title="Message Schema" maxHeight="500" />
`
    : ''
}

${getMessageBindingsMarkdown(message)}

${
  message.externalDocs()
    ? `
## External documentation
- [${message.externalDocs()?.description()}](${message.externalDocs()?.url()})
`
    : ''
}

`;
};

export const getSummary = (message: MessageInterface) => {
  const messageSummary = message.hasSummary() ? message.summary() : '';
  const messageDescription = message.hasDescription() ? message.description() : '';

  let eventCatalogMessageSummary = messageSummary;

  if (!eventCatalogMessageSummary) {
    eventCatalogMessageSummary = messageDescription && messageDescription.length < 150 ? messageDescription : '';
  }

  return eventCatalogMessageSummary;
};

export const messageHasSchema = (message: MessageInterface) => {
  return message.hasPayload() && message.schemaFormat();
};

export const messageIsJSON = (message: MessageInterface) => {
  const fileName = getSchemaFileName(message);
  return fileName.endsWith('.json');
};

export const getSchemaFileName = (message: MessageInterface) => {
  const extension = getFileExtentionFromSchemaFormat(message.schemaFormat());
  return `schema.${extension}`;
};

export const getMessageName = (message: MessageInterface) => {
  return message.hasTitle() && message.title() ? (message.title() as string) : message.id();
};

export const getChannelsForMessage = (
  message: MessageInterface,
  channels: ChannelsInterface,
  document: AsyncAPIDocumentInterface
): { id: string; version: string }[] => {
  let channelsForMessage: ChannelInterface[] = [];
  const globalVersion = document.info().version();

  // Go through all channels and link messages they document
  for (const channel of channels) {
    for (const channelMessage of channel.messages() as MessagesInterface) {
      if (channelMessage.id() === message.id()) {
        channelsForMessage.push(channel);
      }
    }
  }

  // You can also document a message directly to a channel, add them too
  for (const messageChannel of message.channels()) {
    channelsForMessage.push(messageChannel);
  }

  // Make them unique, as there may be overlapping channels
  const uniqueChannels = channelsForMessage.filter(
    (channel, index, self) => index === self.findIndex((t) => t.id() === channel.id())
  );

  return uniqueChannels.map((channel) => {
    const channelVersion = channel.extensions().get('x-eventcatalog-channel-version')?.value() || globalVersion;
    return {
      id: channel.id(),
      version: channelVersion,
    };
  });
};
