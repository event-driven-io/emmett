import {
  assertNotEmptyString,
  assertPositiveNumber,
  type EventsPublisher,
  type EventStore,
  ValidationError,
} from '@event-driven-io/emmett';
import { NotFound, type WebApiSetup } from '@event-driven-io/emmett-honojs';
import type { PongoDb } from '@event-driven-io/pongo';
import type { Context, Hono } from 'hono';
import type { PropsWithChildren } from 'hono/jsx';
import { jsxRenderer } from 'hono/jsx-renderer';
import {
  addProductItemToCurrentShoppingCart,
  cancelCurrentShoppingCart,
  confirmCurrentShoppingCart,
  getShoppingCartId,
  removeProductItemFromCurrentShoppingCart,
} from './application';
import { getDetailsById, type ShoppingCartDetails } from './getDetails';

const demoClientId = 'demo';

const getShoppingCartUIUrl = (clientId: string) =>
  `/ui/clients/${encodeURIComponent(clientId)}/shopping-carts/current`;

const Layout = ({ children }: PropsWithChildren) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Emmett Shopping Cart</title>
      <script
        src="https://cdn.jsdelivr.net/npm/htmx.org@2.0.10/dist/htmx.min.js"
        integrity="sha384-H5SrcfygHmAuTDZphMHqBJLc3FhssKjG7w/CeCpFReSfwBWDTKpkzPP8c+cLsK+V"
        crossorigin="anonymous"
        defer
      ></script>
      <style>{styles}</style>
    </head>
    <body>
      <main>
        <header>
          <p class="eyebrow">Emmett + Hono + HTMX</p>
          <h1>Shopping cart</h1>
          <p>Server-rendered HTML backed by an event-sourced domain.</p>
        </header>
        {children}
      </main>
    </body>
  </html>
);

const ShoppingCartView = (options: {
  clientId: string;
  shoppingCart: ShoppingCartDetails | null;
}) => {
  const { clientId, shoppingCart } = options;
  const cartUrl = getShoppingCartUIUrl(clientId);
  const productItemsUrl = `${cartUrl}/product-items`;
  const productItems = shoppingCart?.productItems ?? [];
  const isOpened = shoppingCart?.status === 'Opened';
  const canAddProduct = shoppingCart === null || isOpened;

  return (
    <section id="shopping-cart" aria-live="polite">
      <div class="cart-heading">
        <div>
          <h2>Current cart</h2>
          <p class="muted">Client: {clientId}</p>
        </div>
        <div class="cart-summary">
          {shoppingCart !== null ? (
            <span class="status">{shoppingCart.status}</span>
          ) : null}
          <strong>{shoppingCart?.productItemsCount ?? 0} items</strong>
        </div>
      </div>

      {productItems.length === 0 ? (
        <p class="empty-state">Your shopping cart is empty.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Quantity</th>
              <th>Unit price</th>
              <th>Subtotal</th>
              {isOpened ? <th>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {productItems.map(({ productId, quantity, unitPrice }) => {
              const removeUrl = `${productItemsUrl}/${encodeURIComponent(productId)}?unitPrice=${encodeURIComponent(unitPrice)}`;

              return (
                <tr>
                  <td>{productId}</td>
                  <td>{quantity}</td>
                  <td>{unitPrice}</td>
                  <td>{unitPrice * quantity}</td>
                  {isOpened ? (
                    <td>
                      <form
                        class="inline-form"
                        action={removeUrl}
                        method="post"
                        hx-delete={removeUrl}
                        hx-target="#shopping-cart"
                        hx-swap="outerHTML"
                        hx-disabled-elt="find button"
                      >
                        <button class="secondary" type="submit">
                          Remove
                        </button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th colspan={3}>Total</th>
              <td>
                <strong>{shoppingCart?.totalAmount ?? 0}</strong>
              </td>
              {isOpened ? <td></td> : null}
            </tr>
          </tfoot>
        </table>
      )}

      {canAddProduct ? (
        <form
          action={productItemsUrl}
          method="post"
          hx-post={productItemsUrl}
          hx-target="#shopping-cart"
          hx-swap="outerHTML"
          hx-disabled-elt="find button"
        >
          <label>
            Product ID
            <input name="productId" type="text" required />
          </label>
          <label>
            Quantity
            <input name="quantity" type="number" min="1" step="1" required />
          </label>
          <button type="submit">Add product</button>
        </form>
      ) : shoppingCart !== null ? (
        <p class="empty-state">
          This shopping cart is {shoppingCart.status.toLowerCase()}.
        </p>
      ) : null}

      {isOpened ? (
        <div class="cart-actions">
          {shoppingCart.productItemsCount > 0 ? (
            <form
              class="inline-form"
              action={`${cartUrl}/confirm`}
              method="post"
              hx-post={`${cartUrl}/confirm`}
              hx-target="#shopping-cart"
              hx-swap="outerHTML"
              hx-disabled-elt="find button"
            >
              <button type="submit">Confirm cart</button>
            </form>
          ) : null}
          <form
            class="inline-form"
            action={`${cartUrl}/cancel`}
            method="post"
            hx-delete={`${cartUrl}/cancel`}
            hx-target="#shopping-cart"
            hx-swap="outerHTML"
            hx-disabled-elt="find button"
          >
            <button class="danger" type="submit">
              Cancel cart
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
};

export const shoppingCartUI =
  (
    eventStore: EventStore,
    readStore: PongoDb,
    eventPublisher: EventsPublisher,
    getUnitPrice: (_productId: string) => Promise<number>,
    getCurrentTime: () => Date,
  ): WebApiSetup =>
  (router: Hono) => {
    router.use(
      '/ui/*',
      jsxRenderer(({ children }) => <Layout>{children}</Layout>),
    );

    router.get('/ui', (context) =>
      context.redirect(getShoppingCartUIUrl(demoClientId)),
    );

    router.get(
      '/ui/clients/:clientId/shopping-carts/current',
      async (context) => {
        const clientId = assertNotEmptyString(context.req.param('clientId'));
        const shoppingCart = await getDetailsById(
          readStore,
          getShoppingCartId(clientId),
        );

        return context.render(
          <ShoppingCartView clientId={clientId} shoppingCart={shoppingCart} />,
        );
      },
    );

    router.post(
      '/ui/clients/:clientId/shopping-carts/current/product-items',
      async (context) => {
        const clientId = assertNotEmptyString(context.req.param('clientId'));
        const body = await context.req.parseBody();

        await addProductItemToCurrentShoppingCart({
          eventStore,
          getUnitPrice,
          getCurrentTime,
          clientId,
          productId:
            typeof body.productId === 'string' ? body.productId : undefined,
          quantity: getQuantityFromForm(body.quantity),
        });

        if (context.req.header('HX-Request') !== 'true')
          return context.redirect(getShoppingCartUIUrl(clientId), 303);

        const shoppingCart = await getDetailsById(
          readStore,
          getShoppingCartId(clientId),
        );

        return context.html(
          <ShoppingCartView clientId={clientId} shoppingCart={shoppingCart} />,
        );
      },
    );

    const renderAfterMutation = async (context: Context, clientId: string) => {
      if (context.req.header('HX-Request') !== 'true')
        return context.redirect(getShoppingCartUIUrl(clientId), 303);

      const shoppingCart = await getDetailsById(
        readStore,
        getShoppingCartId(clientId),
      );

      return context.html(
        <ShoppingCartView clientId={clientId} shoppingCart={shoppingCart} />,
      );
    };

    const removeProductItemHandler = async (context: Context) => {
      const clientId = assertNotEmptyString(context.req.param('clientId'));
      const productId = assertNotEmptyString(context.req.param('productId'));
      const unitPrice = assertPositiveNumber(
        Number(context.req.query('unitPrice')),
      );
      const shoppingCart = await getDetailsById(
        readStore,
        getShoppingCartId(clientId),
      );
      const productItem = shoppingCart?.productItems.find(
        (item) => item.productId === productId && item.unitPrice === unitPrice,
      );

      if (productItem === undefined)
        return NotFound({
          context,
          problemDetails: 'Product item not found',
        });

      await removeProductItemFromCurrentShoppingCart({
        eventStore,
        getCurrentTime,
        clientId,
        productItem,
      });

      return renderAfterMutation(context, clientId);
    };

    const removeProductItemPath =
      '/ui/clients/:clientId/shopping-carts/current/product-items/:productId';
    router.delete(removeProductItemPath, removeProductItemHandler);
    router.post(removeProductItemPath, removeProductItemHandler);

    router.post(
      '/ui/clients/:clientId/shopping-carts/current/confirm',
      async (context) => {
        const clientId = assertNotEmptyString(context.req.param('clientId'));

        await confirmCurrentShoppingCart({
          eventStore,
          eventPublisher,
          getCurrentTime,
          clientId,
        });

        return renderAfterMutation(context, clientId);
      },
    );

    const cancelShoppingCartHandler = async (context: Context) => {
      const clientId = assertNotEmptyString(context.req.param('clientId'));

      await cancelCurrentShoppingCart({
        eventStore,
        getCurrentTime,
        clientId,
      });

      return renderAfterMutation(context, clientId);
    };

    const cancelShoppingCartPath =
      '/ui/clients/:clientId/shopping-carts/current/cancel';
    router.delete(cancelShoppingCartPath, cancelShoppingCartHandler);
    router.post(cancelShoppingCartPath, cancelShoppingCartHandler);
  };

const getQuantityFromForm = (value: string | File | undefined): number => {
  const quantity = assertPositiveNumber(
    typeof value === 'string' ? Number(value) : undefined,
  );

  if (!Number.isInteger(quantity))
    throw new ValidationError('Quantity must be a positive integer');

  return quantity;
};

const styles = `
  :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f5f7fb; color: #18212f; }
  main { width: min(760px, calc(100% - 32px)); margin: 64px auto; }
  header { margin-bottom: 24px; }
  h1, h2, p { margin-top: 0; }
  .eyebrow { color: #5b4ee5; font-size: 0.8rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  .muted { color: #667085; margin-bottom: 0; }
  #shopping-cart { background: white; border: 1px solid #e3e8ef; border-radius: 16px; box-shadow: 0 12px 40px rgb(16 24 40 / 8%); padding: 24px; }
  .cart-heading { align-items: start; display: flex; justify-content: space-between; gap: 16px; }
  .cart-summary { align-items: end; display: grid; gap: 6px; justify-items: end; }
  .status { background: #eef2ff; border-radius: 999px; color: #4338ca; font-size: 0.75rem; font-weight: 700; padding: 4px 8px; text-transform: uppercase; }
  .empty-state { background: #f8fafc; border-radius: 8px; color: #667085; padding: 16px; }
  table { border-collapse: collapse; margin: 20px 0; width: 100%; }
  th, td { border-bottom: 1px solid #e3e8ef; padding: 12px 8px; text-align: left; }
  th { color: #475467; font-size: 0.85rem; }
  tfoot th { text-align: right; }
  form { align-items: end; display: grid; gap: 12px; grid-template-columns: 1fr 140px auto; margin-top: 24px; }
  label { color: #344054; display: grid; font-size: 0.85rem; font-weight: 600; gap: 6px; }
  input, button { border: 1px solid #cfd7e3; border-radius: 8px; font: inherit; min-height: 42px; padding: 8px 12px; }
  input { min-width: 0; width: 100%; }
  button { background: #5b4ee5; border-color: #5b4ee5; color: white; cursor: pointer; font-weight: 700; }
  button.secondary { background: white; border-color: #cfd7e3; color: #344054; }
  button.danger { background: #b42318; border-color: #b42318; }
  button:disabled { cursor: wait; opacity: 0.65; }
  .inline-form { display: block; margin: 0; }
  .cart-actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 16px; }
  @media (max-width: 640px) { form { grid-template-columns: 1fr; } table { font-size: 0.85rem; } }
`;
