########################################
#  First stage of multistage build
########################################
#  Use Build image with label `builder
########################################
# use 
FROM node:lts-alpine AS builder

# Setup working directory for project
WORKDIR /app

COPY ./package.json ./
COPY ./package-lock.json ./
COPY ./tsconfig.json ./
COPY ./tsup.config.ts ./

# install node modules
# use `npm ci` instead of `npm install`
# to install exact version from `package-lock.json`
RUN npm ci

# Copy project files
COPY src ./src

# Build project
RUN npm run build

# sets environment to production
# and removes packages from devDependencies
RUN npm prune --production

########################################
#  Second stage of multistage build
########################################
#  Use other build image as the final one
#    that won't have source codes
########################################
FROM node:lts-alpine

# Setup working directory for project
WORKDIR /app

# Copy published in previous stage binaries
# from the `builder` image
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# Set URL that App will be exposed
EXPOSE 3000

# sets entry point command to automatically
# run application on `docker run`
ENTRYPOINT ["node", "./dist/index.cjs"]