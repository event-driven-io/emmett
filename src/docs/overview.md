# Overview

Everything you need to know about Emmet and Event Sourcing.

## First steps

If you are new to Emmet or Event Sourcing, no problem.

The [Getting Started](/getting-started) guide will help you with your first Emmet project.

## Getting help

If you need help or got stuck, feel free to ask on the [Emmet Community Discord Server](https://discord.gg/fTpqUTMmVa).

## API reference

The [API reference](/api-docs) provides you with definitions and insights of Emmets core building blocks:

- **Events** are the centerpiece of event-sourced systems. They represent both critical points of the business process but are also used as the state.
- **Commands** represent the intent to record a business operation.
- **Event Store** for recording events
- **Command Handlers** aggregate several events from the event store into a single object to perform the intended business operation, resulting in one or more events to record the change.

## How the documenantation is organized

Currently documentation for Emmet is spread across several places: This website, the Emmet Discord and quite a few blog articles.
At the moment we are in the process of consolidating and refactoring these into a single documentation on this website.

Our aim is that each part of the documenation roughly falls into one of these four categories:

- **Tutorials** are lessons that take you by the hand, guiding you step-by-step towards building your own applications with Emmet. Start here if you are new to Emmet, Event Sourcing or writing applications with Typescript. Our [Getting Started](/getting-started) guide is a good place to look at.
- **Topic guides** discuss key topics and concepts at a fairly high level and provide useful background information and explanation.
- **Reference guides** contain technical reference for APIs and other aspects of Emmet. They describe how it works and how to use it, but assume that you have a basic understanding of key concepts.
- **How-to guides** are recipes. They guide you through the steps involved in addressing key problems and use-cases. They are more advanced than tutorials and assume some knowledge of how Emmet works.

In fact, we aim at using [Diataxis](https://diataxis.fr) and its [workflow](https://diataxis.fr/how-to-use-diataxis/) as a systematic, user-centric approach to documentation.
