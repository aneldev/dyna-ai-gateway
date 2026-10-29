# Changelog

All notable changes to `dyna-ai-gateway` are listed here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com); versions follow [semver](https://semver.org). A breaking change lists
what breaks, the migration, and an AI prompt that performs the migration in your codebase.

## [Unreleased]

### Changed

- The shipped `CHAT_MAIN` template puts its stable layers first: the base text, the output format and the profile addendum,
  then the per-call "Today is … locale … timezone" line, the call's instructions and context, the memory and the knowledge
  base. The same layers, one of them moved: a prompt cache can now match the prefix across calls. A tenant's own stored
  `CHAT_MAIN` version is not touched. See `docs/architecture/System prompt production layers.md`.
