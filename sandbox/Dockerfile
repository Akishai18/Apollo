# The sandbox runner image — the untrusted child process lives here.
#
# Build from the REPO ROOT (build context must see core/ and sandbox/):
#   docker build -f sandbox/Dockerfile -t green-sandbox:latest .
#
# `DockerExecutor` runs this with: --network=none --read-only --cap-drop=ALL
# --security-opt=no-new-privileges --memory=… --pids-limit=…  The runner's own
# setrlimit lockdown still applies inside — defense in depth.
FROM python:3.12-slim

# Run as a non-root, unprivileged user. Combined with --cap-drop=ALL and
# --read-only at runtime, the strategy has essentially no surface to act on.
RUN useradd --create-home --uid 10001 sandbox

WORKDIR /app

# Only green-core and green-sandbox are needed to run the runner (pydantic comes
# in as a transitive dependency). Installing both in one pip invocation lets
# green-sandbox's `green-core` requirement resolve against the local copy.
COPY core /app/core
COPY sandbox /app/sandbox
RUN pip install --no-cache-dir ./core ./sandbox

USER sandbox

# The executor passes the module + flags explicitly; this is the same command.
# The runner reads the init frame on stdin, locks down, then serves ticks.
CMD ["python", "-s", "-P", "-m", "green.sandbox.runner"]
