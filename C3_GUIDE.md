# C3 sidecar

The direct-Grok implementation has been replaced by an isolated observer. See [the current C3 setup, API and integration guide](src/c3/README.md).

C3 reads existing component outputs, writes only c3_ tables, and uses the shared AIProvider for coaching. No separate C3 API key is required.
