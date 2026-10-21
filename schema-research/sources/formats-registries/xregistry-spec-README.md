<img src="https://github.com/cncf/artwork/raw/main/projects/xregistry/horizontal/color/xregistry-horizontal-color.svg" alt="xRegistry"></img><br>
<span style="font-size:3px">(<a href="https://github.com/cncf/artwork/tree/main/projects/xregistry">more logos</a>)</span>

<!-- no verify-specs -->
<!-- words: bestpractices changelogs clomonitor codegen coreinfrastructure -->
<!-- words: emails href mailto mcp nuget openssf pypi readme roadmap -->
<!-- words: thetimezoneconverter tz usp workingdrafts xrcg -->

[![CLOMonitor](https://img.shields.io/endpoint?url=https://clomonitor.io/api/projects/cncf/cloudevents/badge)](https://clomonitor.io/projects/cncf/cloudevents)
[![OpenSSF Best Practices](https://bestpractices.coreinfrastructure.org/projects/7295/badge)](https://bestpractices.coreinfrastructure.org/projects/7295)
[![FOSSA Status](https://app.fossa.com/api/projects/custom%2B162%2Fspec.svg?type=small)](https://app.fossa.com/projects/custom%2B162%2Fspec?ref=badge_small)

The xRegistry project (short for "extensible registry") defines an abstract
model for how to manage metadata about resources and provides a REST-based
interface for creating, modifying, deleting and discovering of those resources.
The project includes a "core" specification that defines the basic model and
APIs of a Registry and a set of domain-specific specifications that extend that
core for particular use cases. By leveraging the same "core" model/APIs,
generic tooling and common patterns of Registry access can be developed which
help create an interoperable (and standard) interface. See
[A Quick Introduction to
xRegistry](core/primer.md#3-a-quick-introduction-to-xregistry) for more
information.

It is expected that further specifications will be developed, both as part
of the xRegistry project and outside, that will leverage this framework for
additional purposes.

xRegistry was first developed under the [CloudEvents](https://cloudevents.io)
project, and in April 2023 it was split into its own project but continues
to share many organizational resources with the CloudEvents and CNCF Serverless
Working Group (such as the weekly meetings).

The name `xRegistry` (standing for extensible registry) is meant to be written
with a lowercase `x`, even when the first word in a sentence.

## xRegistry Artifacts

|                               |                                 Latest Release                                  |                                      Working Draft                                       |
| :---------------------------- | :-----------------------------------------------------------------------------: | :--------------------------------------------------------------------------------------: |
| **Core xRegistry Specification:**    |
| xRegistry                     | [v1.0-rc4](https://github.com/xregistry/spec/blob/v1.0-rc4/core/spec.md) | [WIP](core/spec.md) |
|                               |
| **Domain Specific Specifications:**  |
| Endpoint Registry             | [v1.0-rc4](https://github.com/xregistry/spec/blob/v1.0-rc4/endpoint/spec.md) | [WIP](endpoint/spec.md)                         |
| Message Definitions Registry  | [v1.0-rc4](https://github.com/xregistry/spec/blob/v1.0-rc4/message/spec.md) | [WIP](message/spec.md)                         |
| Schema Registry               | [v1.0-rc4](https://github.com/xregistry/spec/blob/v1.0-rc4/schema/spec.md) | [WIP](schema/spec.md)                         |
|                               |
| **Proposed New Specifications:** |
| Working Drafts               | n/a | [View drafts](workingdrafts/README.md)                 |
|                               |
| **Additional Documentation:** |
| xRegistry Primer              | [v1.0-rc4](https://github.com/xregistry/spec/blob/v1.0-rc4/core/primer.md) | [WIP](core/primer.md)                          |
| Pagination Specification      | n/a | [WIP](pagination/spec.md)                          |
|                               |
| **Even More:** |
| Server & CLI Reference Implementation | [xregistry/server](https://github.com/xregistry/server) |
| Code & File Generation CLI (`xrcg`)   | [xregistry/codegen](https://github.com/xregistry/codegen) |
| Web Viewer for xRegistry APIs         | [xregistry/viewer](https://github.com/xregistry/viewer) |
| xRegistry Proxies for package registries (NPM, PyPI, Maven, NuGet, OCI, MCP) | [xregistry/xrproxy](https://github.com/xregistry/xrproxy) |
| [Samples](core/samples/README.md) | |

Machine-readable schemas for each specification's document format are
published alongside the specs as JSON Schema (`document-schema.json`),
Avro (`document-schema.avsc`), and OpenAPI (`openapi.json`) in the
`schemas/` subdirectory of each domain spec
([endpoint](endpoint/schemas/), [message](message/schemas/),
[schema](schema/schemas/)). The core model has its own JSON Schema at
[core/model.schema.json](core/model.schema.json).

Additional release related information:
  [Historical releases and changelogs](docs/RELEASES.md)

If you are new to the family of xRegistry specifications, it is recommended
that you start by reading the [xRegistry Primer](core/primer.md) for an
overview of the specification's goals and design decisions, and then move on
to the [core specification](core/spec.md).

## Community and Docs

Learn more about the people and organizations who are creating a dynamic cloud
native ecosystem by making our systems interoperable with xRegistry.

- Our [Governance](docs/GOVERNANCE.md) documentation.
- [Contributing](docs/CONTRIBUTING.md) guidance.
- [Roadmap](docs/ROADMAP.md)
- [Contributors](docs/contributors.md): people and organizations who helped
  us get started or are actively working on the xRegistry specifications.
- [Presentations, notes and other misc shared
  docs](https://drive.google.com/drive/folders/1DjeazDhtUsWP0mQIzu4XOzNxF2EiGNvN?usp=sharing)
- [Demos & open source](docs/README.md) -- if you have something to share
  about your use of xRegistry, please submit a PR!
- [Code of Conduct](https://github.com/cncf/foundation/blob/master/code-of-conduct.md)

This repository does not include non-English versions of the documentation. If
English is not your primary language and doing the translation yourself via any
number of freely available tools (e.g. browsers, AI) is problematic please let
us know.

### Security Concerns

If there is a security concern with one of the specifications in this
repository, please [open an issue](https://github.com/xregistry/spec/issues).

### Communications

The main mailing list for e-mail communications:

- Send emails to: [cncf-xregistry](mailto:cncf-xregistry@lists.cncf.io)
- To subscribe see: https://lists.cncf.io/g/cncf-xregistry
- Archives are at: https://lists.cncf.io/g/cncf-xregistry/topics

And a #xregistry Slack channel under
[CNCF's Slack workspace](http://slack.cncf.io/).

### Meeting Time

See the [CNCF public events calendar](https://www.cncf.io/community/calendar/).
This specification is being developed by the
[CNCF Serverless Working Group](https://github.com/cncf/wg-serverless). This
working group meets every Thursday at 9AM PT (USA Pacific)
([World Time Zone Converter](http://www.thetimezoneconverter.com/?t=9:00%20am&tz=San%20Francisco&)):

Please see the
[meeting minutes doc](https://docs.google.com/document/d/1OVF68rpuPK5shIHILK9JOqlZBbfe91RNzQ7u_P7YCDE/edit#)
for the latest information on how to join the calls.

The working group also meets
* every Tuesday & Wednesday at 9AM ET (USA Eastern Time)
* and every Friday at 8:30AM ET (USA Eastern Time)

to develop xRegistry specifically. For those meetings, please see the
[xRegistry Meeting Notes](https://docs.google.com/document/d/1YtBnjAyNdMLhAFYiq4yTrHcWpFjW-FWcV9neCTL6XRs/edit?usp=sharing).

Periodically, the group may have in-person meetings that coincide with a major
conference. Please see the
[meeting minutes doc](https://docs.google.com/document/d/1OVF68rpuPK5shIHILK9JOqlZBbfe91RNzQ7u_P7YCDE/edit#)
for any future plans.
