import utils from '@eventcatalog/sdk';
import chalk from 'chalk';

// The event.catalog.js values for your plugin
type EventCatalogConfig = any;

// Configuration the users give your catalog
type GeneratorProps = {
  debug?: boolean;
};

const log = console.log;

export default async (config: EventCatalogConfig, options: GeneratorProps) => {

  // This is set by EventCatalog. This is the directory where the catalog is stored
  const eventCatalogDirectory = process.env.PROJECT_DIR;

  if (!eventCatalogDirectory) {
    throw new Error('Please provide catalog url (env variable PROJECT_DIR)');
  }

  // EventCatalog SDK (https://www.eventcatalog.dev/docs/sdk)
  const { getEvent, writeEvent } = utils(eventCatalogDirectory);

  // Example, get an event
  const event = await getEvent('my-event');

  if (!event) {
    await writeEvent({
      id: 'my-event',
      name: 'My Event',
      version: '1.0.0',
      summary: 'This is my event',
      markdown: 'This is my event',
      badges: [{ content: 'Event', textColor: 'blue', backgroundColor: 'blue' }],
    });
    if(options.debug) {
      log(chalk.green('Event created hello!'));
    }
  } else {
    if(options.debug) {
      log(chalk.green('Event already exists!'));
    }
  }

};
