# Snorkeling Documentation

This directory contains the Docusaurus documentation site for Snorkeling.

Snorkeling is a customization fork built on top of Wave Terminal, so some docs still describe inherited Wave behavior. Snorkeling-specific pages should clearly distinguish runtime facts that still use upstream names, such as `wsh`, `WAVETERM_*`, and `waveai:*`.

## Development

```bash
npm install
npm run start
```

## Build

```bash
npm run build -- --locale en
npm run build -- --locale zh-Hans
```
