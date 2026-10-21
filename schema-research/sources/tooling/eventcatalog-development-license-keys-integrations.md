# Getting a license key for integrations

Copy as Markdown[View as Markdown](/docs/development/license-keys/integrations.md)

***

EventCatalog integrations (sometimes called plugins) let you generate your catalog from sources you already have — OpenAPI specs, AsyncAPI documents, Backstage, federated catalogs, and more. You can see the full list on the [integrations page](/integrations.md).

Official integrations are included with EventCatalog Scale. Start Scale from your [EventCatalog Cloud dashboard](https://eventcatalog.cloud/dashboard) and use your Scale license key to unlock supported integrations in your catalog.

![Pick your integrations in EventCatalog Cloud](/assets/images/pick-your-integraions-aecb814801cf4e0d0e768633cbdebc05.png)

Once Scale is active, your license key appears on your [API keys page](https://eventcatalog.cloud/dashboard/api-keys):

![Your license keys in the EventCatalog Cloud API keys dashboard](/assets/images/api-keys-dashboard-5638b64dedc1eb497c2463160147b934.png)

## Adding your Scale key to your catalog[​](#adding-your-scale-key-to-your-catalog "Direct link to Adding your Scale key to your catalog")

Copy your Scale license key from your dashboard into your `.env` file:

.env

```
EVENTCATALOG_SCALE_LICENSE_KEY=your-scale-license-key-here
```

Then configure the integration in your `eventcatalog.config.js` as described in the [integration's documentation](/integrations.md).

Using plugin API keys?

If you already have older plugin-specific API keys, you can still use them with the environment variables shown in each integration's documentation.

For example, the OpenAPI plugin supports:

.env

```
EVENTCATALOG_LICENSE_KEY_OPENAPI=your-license-key-here
```

For new projects, use `EVENTCATALOG_SCALE_LICENSE_KEY`.

## Trying multiple integrations[​](#trying-multiple-integrations "Direct link to Trying multiple integrations")

Scale includes all official integrations, so you can configure multiple integrations in the same catalog with the same Scale license key.

## Need more time?[​](#need-more-time "Direct link to Need more time?")

If 30 days isn't enough to evaluate Scale and integrations in your environment, email us at `hello@eventcatalog.dev` and we'll extend your trial.
