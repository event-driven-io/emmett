# Contributing to Emmett

We take Pull Requests!

## Before you send Pull Request

1. Contact the contributors via the [Discord channel](https://discord.gg/fTpqUTMmVa) or the [Github Issue](https://github.com/event-driven-io/emmett/issues/new) to make sure that this is issue or bug should be handled with proposed way. Send details of your case and explain the details of the proposed solution.
2. Once you get approval from one of the maintainers, you can start to work on your code change.
3. After your changes are ready, make sure that you covered your case with automated tests and verify that you have limited the number of breaking changes to a bare minimum.
4. We also highly appreciate any relevant updates to the documentation.
5. Make sure that your code is compiling and all automated tests are passing.

## After you have sent Pull Request

1. Make sure that you applied or answered all the feedback from the maintainers.
2. We're trying to be as much responsive as we can, but if we didn't respond to you, feel free to ping us on the [Discord channel](https://gitter.im/event-driven-io/emmett).
3. Pull request will be merged when you get approvals from at least one of the maintainers (and no rejection from others). Pull request will be tagged with the target Emmett version in which it will be released. We also label the Pull Requests with information about the type of change.

## Setup your work environment

We try to limit the number of necessary setup to a minimum, but few steps are still needed:

### 1. Install the latest Node.js LTS version

Available [here](https://Node.js.org/en/download/).

If you're using [NVM](https://github.com/nvm-sh/nvm) you can also call:

```shell
nvm install
```

and

```shell
nvm use
```

To use current recommended version.

### 2. Install Docker

Available [here](https://docs.docker.com/engine/install/).

You are now ready to contribute to Emmett.

### 3. Setup dev environment

We recommend using VSCode and installing the following extensions:

- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint),
- [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode),
- [node:test runner](https://marketplace.visualstudio.com/items?itemName=connor4312.nodejs-testing)
- [Vitest runner](https://marketplace.visualstudio.com/items?itemName=vitest.explorer)

This will ensure that all workspace settings around code style will be automatically applied.

**You can install all of them automatically by running "Install All Recommended Extensions" VSCode task** (_**CTRL+SHIFT+P** => Run Task => Install All Recommended Extensions_).

You can streamling setup by running setup script:

- For Linux and MacOS

```shell
./setup.sh
```

- For Windows

```shell
.\buildScript.ps1
```

Or perform manual steps

### 3.1. Go to source codes

Source codes are located under [./src/](./src/) folder.

```shell
cd src
```

### 3.2. Install packages

```shell
npm install
```

### 3.3 Build project

```shell
npm run build
```

### 3.4. Run tests

```shell
npm run test
```

If any of those steps didn't work for you, please contact us on [Discord channel](https://discord.gg/fTpqUTMmVa).

## Project structure

Emmett is using [NPM Workspaces](https://docs.npmjs.com/cli/v10/using-npm/workspaces).

The source codes are located in [src](./src/) folder. Packages are nested under [./src/packages](./src/packages) folder.

For documentation Emmett is using [Vitepress](https://vitepress.dev). Documentation is located under [./src/docs](./src/docs/) folder.

## Contributing to the documentation

Contributions to the documentation are more than welcome. The Emmett documentation is generated using [Vitepress](https://vitepress.dev/) and the default theme.

To build documentation locally, run in `src` folder:

```shell
npm run docs:dev
```

See also other helpful scripts in [./src/package.json](./src/package.json).

### Frontmatter convention

As per [Vitepress documentation on frontmatter](https://vitepress.dev/guide/frontmatter) the keys for the frontmatter should be in `camelCase`.

### Using the Diataxis documentation system

Emmett uses [Diataxis](https://diataxis.fr) as a guide towards first-class user experience (see [PR#203](https://github.com/event-driven-io/emmett/pull/200)) for its documentation.

Please note that Diataxis is not [prescriptive about the structure of the documentation](https://diataxis.fr/how-to-use-diataxis/#don-t-worry-about-structure). In facto it endorses organic growth towards adapting the documentation system.

### Documentation type

In Diataxis each type of documentation comes with specific language and guidelines. To make the intent of the document clear for contributors,
the type of documentation is defined by the `documentationType` field in the [frontmatter](https://vitepress.dev/guide/frontmatter) of each markdown file:

```md
---
documentationType: tutorial #One of: tutorial, how-to-guide, reference, explanation
---

Lorem ipsum doloret sit amet
```

The possible values for `documentation-type` [correspond to the Diataxis types](https://diataxis.fr/start-here/) as follows:

- `tutorial` for [tutorials](https://diataxis.fr/tutorials/). _A tutorial is an experience that takes place under the guidance of a tutor. A tutorial is always learning-oriented._
- `how-to-guide` for [how-to guides](https://diataxis.fr/how-to-guides/). _How-to guides are directions that guide the reader through a problem or towards a result. How-to guides are goal-oriented._
- `reference` for [reference documentation](https://diataxis.fr/reference/). _Reference guides are technical descriptions of the machinery and how to operate it. Reference material is information-oriented._
- `explanation` for [explanations](https://diataxis.fr/explanation/)._Explanation is a discursive treatment of a subject, that permits reflection. Explanation is understanding-oriented._

It is recommended to take a look at [the Diataxis compass](https://diataxis.fr/compass/) when unsure which type might be most appropriate for a document.

## Working with the Git

1. Fork the repository.
2. Create a feature branch from the `main` branch.
3. We're not squashing the changes and using rebase strategy for our branches (see more in [Git documentation](https://git-scm.com/book/en/v2/Git-Branching-Rebasing)). Having that, we highly recommend using clear commit messages. Commits should also represent the unit of change.
4. Before sending PR to make sure that you rebased the latest `main` branch from the main Emmett repository.
5. When you're ready to create the [Pull Request on GitHub](https://github.com/event-driven-io/emmett/compare).

## Code style

Emmett is using the recommended [TypeScript](./src/tsconfig.shared.json), [ESLint](./src/.eslintrc.json) and [Prettier](./src/.prettierrc.json) coding style configurations. They should be supported by all popular IDE (eg. Visual Studio Code, WebStorm) so if you didn't disabled it manually they should be automatically applied after opening the solution. We also recommend turning automatic formatting on saving to have all the rules applied.

## Licensing and legal rights

By contributing to Emmett:

1. You assert that contribution is your original work.
2. You assert that you have the right to assign the copyright for the work.

## Code of Conduct

This project has adopted the code of conduct defined by the [Contributor Covenant](http://contributor-covenant.org/) to clarify expected behavior in our community.
