# syntax=docker/dockerfile:1

# 1) Build the SPA bundle.
FROM oven/bun:1-alpine AS web
WORKDIR /web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build

# 2) Build the Go portal with the SPA embedded (web/dist -> internal/spa/dist).
FROM golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /web/dist ./internal/spa/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/portal ./cmd/portal

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/portal /portal
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/portal"]
