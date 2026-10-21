<img src="https://github.com/cncf/artwork/raw/main/projects/xregistry/horizontal/color/xregistry-horizontal-color.svg" alt="xRegistry" style="max-height: 30px;">

# xRegistry - Common Package Registry Proxies

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)
![Docker](https://img.shields.io/badge/docker-supported-blue.svg)

![Build Images](https://github.com/xregistry/xrproxy/actions/workflows/build-images.yml/badge.svg)

This project contains a set of read-only xRegistry server implementations that
proxy several popular package registries (NPM, PyPI, Maven, NuGet, OCI, MCP) behind a
unified xRegistry-compliant API.

In addition, the project contains a bridge service that merges the individual
registries into a single API endpoint, providing a consolidated view of all
package metadata.

This shows how the CNCF xRegistry model can be used to create a unified metadata
graph for dependency management across multiple package ecosystems for polyglot
applications.

The API and model declarations follow the official [xRegistry](https://xregistry.io) specification that
is being developed as a CNCF sandbox project at https://github.com/xregistry/spec

## Overview

- **Unified API**: Single endpoint for all package registries
- **xRegistry Compliant**: Follows the official xRegistry specification
- **Multi-Registry Support**: NPM, PyPI, Maven, NuGet, and OCI registries
- **Docker Ready**: Containerized deployment with Docker Compose
- **Azure Integration**: Deploy to Azure Container Apps with GitHub Actions
- **Bridge Architecture**: Intelligent proxy routing to backend services

## Quick Start

### Prerequisites

- **Node.js** v16 or later
- **Docker** (optional, for containerized deployment)
- **Git**

### Installation

```bash
# Clone the repository
git clone https://github.com/xregistry/xrproxy.git
cd xrproxy

# Install dependencies
npm install
```

### Running the Services

#### Option 1: All-in-One Script (Recommended)

For Windows:

```bash
# Command Prompt
start-servers-dynamic.bat

# PowerShell
.\start-servers.ps1
```

#### Option 2: Docker Compose

```bash
# Start all services
docker-compose up

# Start in background
docker-compose up -d

# Start specific services
docker-compose up npm pypi
```

#### Option 3: Individual Services

```bash
# Start NPM registry
npm run start:npm

# Start PyPI registry
npm run start:pypi

# Start unified bridge (requires other services running)
npm run start:bridge
```

### Web UI (xRegistry Viewer)

The bridge server can optionally serve the [xRegistry Viewer](https://github.com/xregistry/viewer) web interface:

```bash
# PowerShell (Windows)
.\start-bridge-with-viewer.ps1

# Bash (Linux/Mac)
./start-bridge-with-viewer.sh
```

Access the viewer at: `http://localhost:8080/viewer/`

**Features**:

- Web-based UI for browsing xRegistry services
- Visualize package metadata across all registries
- Built-in CORS proxy for external xRegistry endpoints
- Flexible routing (API at root or `/registry/`)

See [bridge/VIEWER.md](bridge/VIEWER.md) for complete documentation.

## 📡 API Endpoints

Once running, the unified bridge provides these endpoints at `http://localhost:8080`:

### Core xRegistry Endpoints

- **`GET /`** - Root document with all registry information
- **`GET /model`** - Unified data model from all registries
- **`GET /capabilities`** - Combined capabilities from all services

### Registry-Specific Endpoints

- **`GET /noderegistries`** - NPM packages (Node.js)
- **`GET /pythonregistries`** - PyPI packages (Python)
- **`GET /javaregistries`** - Maven packages (Java)
- **`GET /dotnetregistries`** - NuGet packages (.NET)
- **`GET /containerregistries`** - OCI images (Containers)
- **`GET /mcpproviders`** - MCP packages (Model Context Protocol)
- **`GET /composerregistries`** - Packagist packages grouped by Composer vendor
- **`GET /huggingfaceregistries`** - Hugging Face repositories grouped by owner
- **`GET /terraformregistries`** - Terraform providers/modules grouped by namespace
- **`GET /rubyregistries`** - RubyGems packages
- **`GET /dartregistries`** - pub.dev packages

### Native namespace paths

Packagist, Hugging Face, and Terraform use upstream namespaces as xRegistry Group IDs. Their #203 public-path migration is intentional:

```text
symfony/console                    -> /composerregistries/symfony/packages/console
google-bert/bert-base-uncased      -> /huggingfaceregistries/google-bert/models/bert-base-uncased
hashicorp/aws                      -> /terraformregistries/hashicorp/providers/aws
terraform-aws-modules/vpc/aws      -> /terraformregistries/terraform-aws-modules/modules/vpc~aws
```

Hugging Face truly bare authoritative repository IDs use the valid reserved `_` group; aliases such as `gpt2` resolve to their owner path. Unambiguous removed fixed-group paths under `packagist.org`, `huggingface.co`, and `registry.terraform.io` return HTTP 410 with migration hints that preserve meta/version suffixes. Packagist and Hugging Face enforce bounded upstream scans; Terraform marks its discovery snapshot incomplete, omits non-authoritative counts, and explicitly rejects unadvertised filter/sort operations. See each service README for exact contracts.

### Example Usage

```bash
# Get unified model showing all registry types
curl http://localhost:8080/model

# Browse NPM packages
curl http://localhost:8080/noderegistries

# Get capabilities from all registries
curl http://localhost:8080/capabilities
```

## 🏗️ Architecture

The project uses a bridge architecture where:

1. **Individual Registry Services** run on separate ports:
   - NPM: 3100
   - PyPI: 3000
   - Maven: 3300
   - NuGet: 3200
   - OCI: 3400
   - MCP: 3600

2. **Unified Bridge Service** (port 8080) provides:
   - Single API endpoint
   - Model and capability merging
   - Intelligent request routing
   - Authentication management

## 🧪 Testing the Installation

Changed native-registry models are validated in CI against the official xRegistry `v1.0-rc2` `core/model.schema.json` (pinned commit `dbcbeac1dce9a0653ea39ea504f52edde2dc00a2`):

```bash
npm run test:models
```

### Quick Health Check

```bash
# Test unified bridge
curl http://localhost:8080/

# Check all registries are merged
curl http://localhost:8080/model | jq '.groups | keys'
# Should return: ["containerregistries", "dotnetregistries", "javaregistries", "mcpproviders", "noderegistries", "pythonregistries"]
```

## 🐳 Docker Deployment

### Quick Start with Docker

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Production Deployment

#### Azure Container Apps Deployment

The xRegistry Package Registries project includes fully automated deployment to Azure Container Apps:

```bash
# Set variables
RG_NAME="rg-xregistry-prod"
LOCATION="eastus"
ACR_NAME="xregistryacr"
ACA_ENV_NAME="cae-xregistry-prod"
ACA_NAME="ca-xregistry-unified"

# Create resource group and resources
az group create --name $RG_NAME --location $LOCATION
az acr create --resource-group $RG_NAME --name $ACR_NAME --sku Standard --admin-enabled true
az containerapp env create --name $ACA_ENV_NAME --resource-group $RG_NAME --location $LOCATION
```

**CI/CD Integration:**

- Automated deployments via GitHub Actions workflows
- Multi-platform container builds (AMD64/ARM64)
- Security scanning and health verification

**Monitoring and Health:**

- Built-in health check endpoints
- Application Insights integration
- Container logs accessible via Azure CLI

**Scaling and Updates:**

```bash
# Configure auto-scaling
az containerapp update --name $ACA_NAME --resource-group $RG_NAME \
  --min-replicas 1 --max-replicas 10

# View revisions for rollback
az containerapp revision list --name $ACA_NAME --resource-group $RG_NAME
```

**Resource Optimization:**

- Optimized container configuration (1.75 CPU + 3.5GB memory)
- Resource sharing across registry services
- Non-root container execution for security
- HTTPS-only ingress for secure communications

See [DEPLOYMENT.md](DEPLOYMENT.md) for comprehensive details on:

- Azure Container Apps deployment
- GitHub Actions CI/CD setup
- Production configuration options
- Monitoring and health checks
- Scaling and auto-scaling options
- Security and resource optimization

## 🔧 Configuration

### Environment Variables

| Variable            | Default                    | Description            |
| ------------------- | -------------------------- | ---------------------- |
| `XREGISTRY_PORT`    | `8080`                     | Bridge server port     |
| `XREGISTRY_ENABLE`  | `npm,pypi,maven,nuget,oci` | Enabled registries     |
| `XREGISTRY_BASEURL` | Auto-detected              | Base URL for responses |
| `XREGISTRY_API_KEY` | None                       | Global API key         |
| `NODE_ENV`          | `development`              | Environment mode       |

### Registry-Specific Ports

Each registry can be configured individually:

```bash
# Custom ports
XREGISTRY_NPM_PORT=5000 npm run start:npm
XREGISTRY_PYPI_PORT=5001 npm run start:pypi
```

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development setup
- Coding standards
- Testing guidelines
- Pull request process

### Development Quick Start

```bash
# Validate the canonical service inventory
npm ci
npm run services:validate

# List active services
npm run services:list

# Build one service or the complete active inventory
npm run build:mcp
npm run build
```

`config/services.json` is the source of truth for service IDs, ports, group
types, images, Dockerfiles, integration tests, and initial deployment
resources. Add a planned entry there before creating a new proxy, then change
its status to `active` only when its implementation, image, and deterministic
Docker integration test are present. CI derives its Docker test and image
build matrices from this manifest.

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed development documentation.

## 📚 Documentation

- **[DEVELOPMENT.md](DEVELOPMENT.md)** - Comprehensive development guide
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Production deployment guide
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Contribution guidelines
- **[CHANGELOG.md](CHANGELOG.md)** - Project change history
- **[bridge/VIEWER.md](bridge/VIEWER.md)** - xRegistry Viewer integration guide
- **xRegistry Specification** - See the [official xRegistry specification](https://github.com/xregistry/spec) for standard compliance details

## 🔍 Troubleshooting

### Common Issues

**Port conflicts:**

```bash
# Use dynamic port assignment
.\start-servers-dynamic.bat
```

**Services not starting:**

```bash
# Check dependencies
npm install

# Verify Node.js version
node --version  # Should be v16+
```

**Bridge not connecting:**

```bash
# Rebuild bridge
cd bridge && npm run build

# Check backend services are running
curl http://localhost:3000/noderegistries
curl http://localhost:3100/pythonregistries
```

### Getting Help

- 📝 **Check existing issues** in the GitHub repository
- 🐛 **Report bugs** with detailed steps to reproduce
- 💡 **Request features** through GitHub Discussions
- 📖 **Read the docs** in the linked guides above

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🌟 Acknowledgments

- Built following the [xRegistry specification](https://github.com/xregistry/spec)
- Supports NPM, PyPI, Maven, NuGet, and OCI registries
- Designed for cloud-native deployment on Azure Container Apps

---

**Ready to get started?** Use Docker Compose (`docker-compose up`) or the startup scripts to launch all services!
