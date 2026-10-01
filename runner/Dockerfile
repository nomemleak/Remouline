# Correction image ("remouline-runner"): built once, reused for every assignment.
#   docker compose build runner      (or: docker build -t remouline-runner runner/)
# gcc + Criterion + valgrind; the correction pipeline itself is standard-library Python.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      gcc g++ make valgrind libcriterion-dev python3 coreutils ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY pipeline.py /opt/remouline/pipeline.py

# The container always runs as uid 1000 with a read-only root filesystem;
# only /work (bind mount) and /tmp (tmpfs) are writable.
ENV HOME=/tmp PYTHONDONTWRITEBYTECODE=1
WORKDIR /work
CMD ["python3", "/opt/remouline/pipeline.py", "--help"]
