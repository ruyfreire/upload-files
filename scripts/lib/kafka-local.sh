#!/usr/bin/env bash
# Funções compartilhadas: Kafka local (KRaft) para bootstrap e deploy-cfn.
# Uso: source "$(dirname "$0")/lib/kafka-local.sh"

KAFKA_TOPIC_DEFAULT="${KAFKA_TOPIC:-csv.processed}"
KAFKA_PARTITIONS_DEFAULT="${KAFKA_PARTITIONS:-1}"
KAFKA_REPLICAS_DEFAULT="${KAFKA_REPLICAS:-1}"
KAFKA_BOOTSTRAP_INTERNAL="${KAFKA_BOOTSTRAP_INTERNAL:-localhost:9092}"

ensure_localstack_health() {
  if ! curl -sf http://127.0.0.1:4566/_localstack/health >/dev/null 2>&1; then
    echo "ERRO: LocalStack não responde em http://127.0.0.1:4566"
    echo "      Inicie o LocalStack antes do bootstrap (ex.: container localstack-main)."
    exit 1
  fi
}

ensure_kafka_stack() {
  local project_dir="${1:?project_dir required}"
  cd "${project_dir}"

  echo ">> Subindo Apache Kafka (docker compose)..."
  docker compose -f docker-compose.yml up -d kafka kafka-ui

  echo ">> Aguardando Kafka healthy..."
  local i
  for i in $(seq 1 40); do
    if docker inspect -f '{{.State.Health.Status}}' csv-study-kafka 2>/dev/null | grep -q healthy; then
      echo "  -> Kafka pronto."
      break
    fi
    if [[ "${i}" -eq 40 ]]; then
      echo "ERRO: csv-study-kafka não ficou healthy a tempo."
      docker logs csv-study-kafka --tail 30 2>/dev/null || true
      exit 1
    fi
    sleep 3
  done

  if docker ps --format '{{.Names}}' | grep -q '^localstack-main$'; then
    docker network connect study-net localstack-main 2>/dev/null || true
    echo "  -> localstack-main na rede study-net (se ainda não estava)"
  fi
}

ensure_kafka_topic() {
  local topic="${1:-${KAFKA_TOPIC_DEFAULT}}"
  local partitions="${2:-${KAFKA_PARTITIONS_DEFAULT}}"
  local replicas="${3:-${KAFKA_REPLICAS_DEFAULT}}"

  echo ">> Tópico Kafka: ${topic}"
  docker exec csv-study-kafka /opt/kafka/bin/kafka-topics.sh \
    --bootstrap-server "${KAFKA_BOOTSTRAP_INTERNAL}" \
    --create \
    --topic "${topic}" \
    --partitions "${partitions}" \
    --replication-factor "${replicas}" \
    --if-not-exists 2>/dev/null || true

  docker exec csv-study-kafka /opt/kafka/bin/kafka-topics.sh \
    --bootstrap-server "${KAFKA_BOOTSTRAP_INTERNAL}" \
    --describe \
    --topic "${topic}" >/dev/null
  echo "  -> Tópico OK: ${topic}"
}
