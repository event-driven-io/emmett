# Version messages

Copy as Markdown[View as Markdown](/docs/development/guides/resources/messages/versioning-and-lifecycle/version-messages.md)

***

All content in EventCatalog can be versioned. This allows you to keep historic versions of content which can give context to users why things are changing.

## How to version a message[​](#how-to-version-a-message "Direct link to How to version a message")

1. Create a `/versioned` directory inside the `/events|commands|queries` folder if one is not created already.

2. Create a new folder with the version number inside the folder.
   <!-- -->
   * Example: `/events|commands|queries/InventoryOutOfStock/versioned/0.0.1`

3. Copy contents into the new folder, it at least needs your index.mdx file.

   <!-- -->

   * Example: `/events|commands|queries/InventoryOutOfStock/versioned/0.0.1/index.mdx`
   * Note: the version inside this index.mdx file would be `0.0.1`

4. Bump the version of the `index.mdx` file in the route of the domain.
   <!-- -->
   * Example `/events|commands|queries/InventoryOutOfStock/index.mdx`, change the `version` to `0.0.2`

* events

  <!-- -->

  /

  * InventoryOutOfStock

    <!-- -->

    /

    * index.mdx
    * versioned
      <!-- -->
      /
      * 0.0.1
        <!-- -->
        /
        * index.mdx

## How to navigate to versions[​](#how-to-navigate-to-versions "Direct link to How to navigate to versions")

EventCatalog will automatically create links for you within your latest version of your document. Users will also be able to navigate to any version by adding the version in the url (e.g /docs/events|commands|queries/InventoryOutOfStock/1.0.2 would load the 1.0.2 version of this service).

![Example](/assets/images/versioned-cb5c80464784c26d425ff797e95b5fa6.png)
