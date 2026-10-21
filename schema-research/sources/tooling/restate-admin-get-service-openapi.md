> ## Documentation Index
> Fetch the complete documentation index at: https://docs.restate.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Get service OpenAPI definition

> Returns the OpenAPI 3.1 specification for the service, describing all handlers and their request/response schemas.



## OpenAPI

````yaml /schemas/openapi-admin.json get /services/{service}/openapi
openapi: 3.1.0
info:
  title: Admin API
  description: >-
    This API exposes the admin operations of a Restate cluster, such as
    registering new service deployments, interacting with running invocations,
    register Kafka subscriptions, retrieve service metadata. For an overview,
    check out the [Server
    documentation](https://docs.restate.dev/server/overview). If you're looking
    for how to call your services, check out the [Ingress HTTP
    API](https://docs.restate.dev/invoke/http) instead.
  contact:
    name: restate.dev
  license:
    name: MIT
    url: https://opensource.org/license/mit
  version: 1.7.12
servers: []
security: []
tags:
  - name: deployment
    description: Service Deployment management
  - name: invocation
    description: Invocation management
    externalDocs:
      url: https://docs.restate.dev/services/invocation/http
      description: Invocations documentation
  - name: subscription
    description: Subscription management
    externalDocs:
      url: >-
        https://docs.restate.dev/services/invocation/kafka#managing-kafka-subscriptions
      description: Kafka subscriptions documentation
  - name: kafka_cluster
    description: Kafka cluster management
  - name: service
    description: Service management
  - name: service_handler
    description: Service handlers metadata
  - name: vqueue
    description: Virtual queue management
  - name: cluster_health
    description: Cluster health
  - name: health
    description: Admin API health
  - name: version
    description: API Version
  - name: introspection
    description: System introspection
  - name: rule
    description: Limiter rule book management
externalDocs:
  url: https://docs.restate.dev/server/overview
  description: Restate server documentation
paths:
  /services/{service}/openapi:
    get:
      tags:
        - service
      summary: Get service OpenAPI definition
      description: >-
        Returns the OpenAPI 3.1 specification for the service, describing all
        handlers and their request/response schemas.
      operationId: get_service_openapi
      parameters:
        - name: service
          in: path
          description: Fully qualified service name.
          required: true
          schema:
            type: string
      responses:
        '200':
          description: OpenAPI 3.1 specification document describing the service's API
          content:
            application/json:
              schema: {}
        '400':
          $ref: '#/components/responses/BadRequest'
        '404':
          $ref: '#/components/responses/NotFound'
        '405':
          $ref: '#/components/responses/MethodNotAllowed'
        '409':
          $ref: '#/components/responses/Conflict'
        '500':
          $ref: '#/components/responses/InternalServerError'
components:
  responses:
    BadRequest:
      description: Bad request
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorDescriptionResponse'
    NotFound:
      description: Not found
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorDescriptionResponse'
    MethodNotAllowed:
      description: Method not allowed
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorDescriptionResponse'
    Conflict:
      description: Conflict
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorDescriptionResponse'
    InternalServerError:
      description: Internal server error
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorDescriptionResponse'
  schemas:
    ErrorDescriptionResponse:
      type: object
      description: |-
        # Error description response

        Error details of the response
      required:
        - message
      properties:
        message:
          type: string
        restate_code:
          type:
            - string
            - 'null'
          description: |-
            # Restate code

            Restate error code describing this error

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.