ARG PROXY_IMAGE=debian:bookworm-slim
FROM ${PROXY_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends squid ca-certificates && rm -rf /var/lib/apt/lists/* && groupadd --gid 1000 domos && useradd --uid 1000 --gid 1000 domos
COPY deploy/squid.conf /etc/squid/squid.conf
USER 1000:1000
HEALTHCHECK --interval=1s --timeout=1s --start-period=1s --retries=10 CMD ["squid", "-k", "check"]
CMD ["squid", "-N", "-f", "/etc/squid/squid.conf"]
