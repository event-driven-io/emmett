import {
  getInMemoryEventStore,
  getInMemoryMessageBus,
  type EventStore,
} from '@event-driven-io/emmett';
import { otelAssertions } from '@event-driven-io/almanac/otel';
import {
  ApiSpecification,
  existingStream,
  expectError,
  expectNewEvents,
  expectResponse,
  getApplication,
} from '@event-driven-io/emmett-expressjs';
import { EmmettInstrumentation } from '@event-driven-io/emmett/otel';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { expect } from 'vitest';
import { type PricedProductItem, type ShoppingCartEvent } from './shoppingCart';

const getUnitPrice = (_productId: string) => {
  return Promise.resolve(100);
};

void describe('ShoppingCart', () => {
  const spanExporter = new InMemorySpanExporter();
  const metricExporter = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000,
  });
  const spanProcessor = new SimpleSpanProcessor(spanExporter);
  const observabilitySDK = new NodeSDK({
    serviceName: 'expressjs-with-postgresql',
    spanProcessors: [spanProcessor],
    metricReader,
    instrumentations: [new EmmettInstrumentation()],
  });
  let clientId: string;
  let shoppingCartId: string;
  let shoppingCartApi: typeof import('./api').shoppingCartApi;

  before(async () => {
    observabilitySDK.start();
    ({ shoppingCartApi } = await import('./api'));
  });

  after(() => observabilitySDK.shutdown());

  beforeEach(() => {
    spanExporter.reset();
    metricExporter.reset();
    clientId = randomUUID();
    shoppingCartId = `shopping_cart:${clientId}:current`;
  });

  void it('exports correlated Emmett and event-store spans plus command and event metrics', () =>
    given()
      .when((request) =>
        request
          .post(`/clients/${clientId}/shopping-carts/current/product-items`)
          .send(productItem),
      )
      .then(expectResponse(204))
      .then(async () => {
        await spanProcessor.forceFlush();
        const spans = spanExporter.getFinishedSpans();
        otelAssertions
          .spans(spans)
          .hasSingleSpanNamed('command.handle')
          .hasChildNamed('eventStore.appendToStream');

        await metricReader.forceFlush();
        const metrics = metricExporter
          .getMetrics()
          .flatMap((resource) => resource.scopeMetrics)
          .flatMap((scope) => scope.metrics);
        expect(
          metrics.some(
            (metric) =>
              metric.descriptor.name === 'emmett.command.handling.duration',
          ),
        ).toBe(true);
        expect(
          metrics.some(
            (metric) =>
              metric.descriptor.name === 'emmett.event.appending.count',
          ),
        ).toBe(true);
      }));

  void describe('When empty', () => {
    void it('should add product item', () => {
      return given()
        .when((request) =>
          request
            .post(`/clients/${clientId}/shopping-carts/current/product-items`)
            .send(productItem),
        )
        .then([
          expectNewEvents(shoppingCartId, [
            {
              type: 'ProductItemAddedToShoppingCart',
              data: {
                shoppingCartId,
                clientId,
                productItem,
                addedAt: now,
              },
              metadata: { clientId },
            },
          ]),
        ]);
    });
  });

  void describe('When opened with product item', () => {
    void it('should confirm', () => {
      return given(
        existingStream(shoppingCartId, [
          {
            type: 'ProductItemAddedToShoppingCart',
            data: {
              shoppingCartId,
              clientId,
              productItem,
              addedAt: oldTime,
            },
            metadata: { clientId },
          },
        ]),
      )
        .when((request) =>
          request.post(`/clients/${clientId}/shopping-carts/current/confirm`),
        )
        .then([
          expectResponse(204),
          expectNewEvents(shoppingCartId, [
            {
              type: 'ShoppingCartConfirmed',
              data: {
                shoppingCartId,
                confirmedAt: now,
              },
              metadata: { clientId },
            },
          ]),
        ]);
    });
  });

  void describe('When confirmed', () => {
    void it('should not add products', () => {
      return given(
        existingStream(shoppingCartId, [
          {
            type: 'ProductItemAddedToShoppingCart',
            data: {
              shoppingCartId,
              clientId,
              productItem,
              addedAt: oldTime,
            },
            metadata: { clientId },
          },
          {
            type: 'ShoppingCartConfirmed',
            data: { shoppingCartId, confirmedAt: oldTime },
            metadata: { clientId },
          },
        ]),
      )
        .when((request) =>
          request
            .post(`/clients/${clientId}/shopping-carts/current/product-items`)
            .send(productItem),
        )
        .then(
          expectError(403, {
            detail: 'Shopping Cart already closed',
            status: 403,
            title: 'Forbidden',
            type: 'about:blank',
          }),
        );
    });
  });

  const oldTime = new Date();
  const now = new Date();

  const given = ApiSpecification.for<ShoppingCartEvent>(
    (): EventStore => getInMemoryEventStore(),
    (eventStore: EventStore) =>
      getApplication({
        apis: [
          shoppingCartApi(
            eventStore,
            undefined!, //TODO: define recommendation how to use gets here
            getInMemoryMessageBus(),
            getUnitPrice,
            () => now,
          ),
        ],
      }),
  );

  const getRandomProduct = (): PricedProductItem => {
    return {
      productId: randomUUID(),
      unitPrice: 100,
      quantity: Math.random() * 10,
    };
  };

  const productItem = getRandomProduct();
});
