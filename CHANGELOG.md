# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- CI/release pipeline on GitHub Actions: PR/main checks (`ci.yml`), tag + GitHub
  Release on merging a `release/*` PR (`release.yml`), and multi-arch image
  publish to GHCR for portal and collector on `v*` tags (`publish.yml`).
